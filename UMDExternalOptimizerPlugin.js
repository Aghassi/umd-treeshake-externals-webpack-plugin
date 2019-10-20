const { ConcatSource, OriginalSource, ReplaceSource } = require("webpack-sources");
const JavascriptModulesPlugin = require('webpack/lib/JavascriptModulesPlugin');
const NormalModule = require('webpack/lib/NormalModule');
const ExternalModule = require('webpack/lib/ExternalModule');

/**
 * This plugin assumes that you are building for UMD, so we don't do any checking in the module graph
 * against each module to verify that it is of type UMD. We only care about externals
 */
module.exports = class UMDExternalOptimizerPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('UMDExternalOptimizerPlugin', compilation => {
      // Get the hooks for each javascript module so we can render information
      const hooks = JavascriptModulesPlugin.getCompilationHooks(compilation);

      // For rendering the entry
      hooks.renderMain.tap('UMDExternalOptimizerPlugin', (source, { chunk, moduleGraph, chunkGraph, runtimeTemplate }) => {
        // For all chunks in the graph, get the modules that are considered externals
        const externals = chunkGraph.getChunkModules(chunk).filter(
          module =>
            module instanceof ExternalModule &&
            (module.externalType === "umd" || module.externalType === "umd2")
        );
        const rootModules = chunkGraph.getChunkRootModules(chunk);
        let rootModule = null;

        /**
         * Map of externals to their deduped list of connections
         * Connections are a list of "originModules", meaning the module that originally imported the external
         * We will use this list to be able to back track where externals actually should be in the tree.
         * 
         * Each NormalModule is a file that referenced react, and each of those files has a position in the tree.
         * More than one reference means we should put this external IIFE at the first "level" of occurance
         * "level" means depth in the tree (so highest in this case). If more than two modules at the second level (below the root)
         * reference this module, it goes in root, otherwise we find the first usage by a single module and put it there.
         * 
         * If an external only has a single originModule, then we should just put that external at that level in the tree.
         * This avoids use requiring externals unnecessarily
         * 
         * @example
         * {
         *  react: [ NormalModule, NormalModule, NormalModule]
         *  'styled-components': [NormalModule]
         * }
         */
        const externalsToModuleConnections = {};
        const modulesToExternalsMap = {};
        externals.forEach(external => {
          const moduleConnections = [];
          moduleGraph.getIncomingConnections(external).forEach(connection => {
            /**
             * We tease out the origin modules that originally referenced each external as this allows us to determine which ones
             * need to be at the root module, vs being lower down in the tree
             */
            if (!moduleConnections.includes(connection.originModule)) {
              moduleConnections.push(connection.originModule);

              // We also create a lookup per module so we can determine which modules need which externals later
              if (!modulesToExternalsMap[connection.originModule]) {
                modulesToExternalsMap[connection.originModule.request] = [external];
              } else {
                modulesToExternalsMap[connection.originModule.request] = modulesToExternalsMap[connection.originModule].push(external);
              }
            }
            /**
             * If we come across the "root" of the runtime module, then we need
             * to know so we can change the IIFE statement in that chunk so that
             * it can get the external it needs
             */
            if (rootModules.includes(connection.originModule)) {
              rootModule = connection.originModule;
            }
          });
          externalsToModuleConnections[external.request] = moduleConnections;
        });

        /**
         * The main chunk probably doesn't need a dependency unless one of the
         * entries is not dynamic and resides in the chunk.
         * If it does have an entry, we need to wrap it in a template correctly with just that external, not all of them
         */
        if (rootModule) {
          // These are the externals that only the root module requires
          const rootExternals = modulesToExternalsMap[rootModule.request];

          // This is the source that we will return to the compilation so that it gets written for the file
          return new ConcatSource(
            new OriginalSource(
              "(function webpackUniversalModuleDefinition(root, factory) {\n" +
              getAuxilaryComment("commonjs2") +
              "	if(typeof exports === 'object' && typeof module === 'object')\n" +
              "		module.exports = factory(" +
              externalsRequireArray("commonjs2") +
              ");\n" +
              getAuxilaryComment("amd") +
              "	else if(typeof define === 'function' && define.amd)\n" +
              (requiredExternals.length > 0
                ? this.names.amd && this.namedDefine === true
                  ? "		define(" +
                  libraryName(this.names.amd) +
                  ", " +
                  externalsDepsArray(requiredExternals) +
                  ", " +
                  amdFactory +
                  ");\n"
                  : "		define(" +
                  externalsDepsArray(requiredExternals) +
                  ", " +
                  amdFactory +
                  ");\n"
                : this.names.amd && this.namedDefine === true
                  ? "		define(" +
                  libraryName(this.names.amd) +
                  ", [], " +
                  amdFactory +
                  ");\n"
                  : "		define([], " + amdFactory + ");\n") +
              (this.names.root || this.names.commonjs
                ? getAuxilaryComment("commonjs") +
                "	else if(typeof exports === 'object')\n" +
                "		exports[" +
                libraryName(this.names.commonjs || this.names.root) +
                "] = factory(" +
                externalsRequireArray("commonjs") +
                ");\n" +
                getAuxilaryComment("root") +
                "	else\n" +
                "		" +
                replaceKeys(
                  accessorAccess(
                    "root",
                    this.names.root || this.names.commonjs
                  )
                ) +
                " = factory(" +
                externalsRootArray(externals) +
                ");\n"
                : "	else {\n" +
                (externals.length > 0
                  ? "		var a = typeof exports === 'object' ? factory(" +
                  externalsRequireArray("commonjs") +
                  ") : factory(" +
                  externalsRootArray(externals) +
                  ");\n"
                  : "		var a = factory();\n") +
                "		for(var i in a) (typeof exports === 'object' ? exports : root)[i] = a[i];\n" +
                "	}\n") +
              `})(${
              runtimeTemplate.outputOptions.globalObject
              }, function(${externalsArguments(externals)}) {\nreturn `,
              "webpack/universalModuleDefinition"
            ),
            source,
            ";\n})"
          )
        } else {
          /**
           * We need to ensure there are no evals related to externals in the entry chunk (webpack puts it there by default)
           * The starting string is the starting block of the external decleration.
           * Since we don't want any externals in the main chunk here, we are splicing them out
           * An externals block starts with
           * ```
           * /***\/ "react":
           * ```
           * and ends with
           * 
           * ```
           * /***\/ }),
           * ```
           * 
           * We use this knowledge to know what code to strip out
           */
          externals.forEach((external) => {
            // gets the first occurance of the decleration. ReplaceSource uses a full source string, so we need to find the index relative to that
            const startIndex = source.source().indexOf(`\n/***/ "${external.request}":\n`);
            // We add the length of the block we are trying to find to ensure that it is also removed during the replace
            const endIndex = source.source().indexOf('\n\n/***/ })', startIndex) + '\n\n/***/ })'.length;
            // Replace Source is a module that takes the original source string and removes all replacements requested
            const replacedSource = new ReplaceSource(source);
            // Each new `replace` call is stored in an array that `ReplaceSource` uses when `.source()` is called. It iterates over each replacement and performs the replacement
            replacedSource.replace(startIndex, endIndex, '')
            // We return a new `ConcatSource` as that seems to be the way that webpack does it internally
            source = new ConcatSource(replacedSource.source());
          })

          // This will return the entry module without any external evals defined
          return source;
        }
      });

      //   // For rendering the chunks
      //   hooks.renderChunk.tap('UMDExternalOptimizerPlugin', (source, { chunk, moduleGraph, chunkGraph, runtimeTemplate }) => {
      //     // For all chunks in the graph, get the modules that are considered externals
      //     const modules = chunkGraph.getChunkModules(chunk).filter(
      //       module =>
      //         module instanceof ExternalModule &&
      //         (module.externalType === "umd" || module.externalType === "umd2")
      //     );
      //   });

    });
  }
}