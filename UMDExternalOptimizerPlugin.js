const JavascriptModulesPlugin = require('webpack/lib/JavascriptModulesPlugin');
const NormalModule = require('webpack/lib/NormalModule');
const ExternalModule = require('webpack/lib/ExternalModule');

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
        const externalConnections = {};
        externals.forEach(external => {
          const moduleConnections = [];
          moduleGraph.getIncomingConnections(external).forEach(connection => {
            /**
             * We tease out the origin modules that originally referenced each external as this allows us to determine which ones
             * need to be at the root module, vs being lower down in the tree
             */
            if (!moduleConnections.includes(connection.originModule)) {
              moduleConnections.push(connection.originModule);
            }
          });
          externalConnections[external.request] = moduleConnections;
        })

        
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