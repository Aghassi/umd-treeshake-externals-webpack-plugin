const { ConcatSource, OriginalSource, ReplaceSource } = require("webpack-sources");
const JavascriptModulesPlugin = require('webpack/lib/JavascriptModulesPlugin');
const JsonpTemplatePlugin = require('webpack/lib/web/JsonpTemplatePlugin');
const UmdTemplatePlugin = require('webpack/lib/UmdTemplatePlugin');
const ExternalModule = require('webpack/lib/ExternalModule');
const NormalModule = require('webpack/lib/NormalModule');
const ImportDependency = require('webpack/lib/dependencies/ImportDependency');
const Template = require("webpack/lib/Template");

/**
 * @param {string[]} accessor the accessor to convert to path
 * @returns {string} the path
 */
const accessorToObjectAccess = accessor => {
  return accessor.map(a => `[${JSON.stringify(a)}]`).join("");
};

/**
 * @param {string=} base the path prefix
 * @param {string|string[]} accessor the accessor
 * @param {string=} joinWith the element separator
 * @returns {string} the path
 */
const accessorAccess = (base, accessor, joinWith = ", ") => {
  const accessors = Array.isArray(accessor) ? accessor : [accessor];
  return accessors
    .map((_, idx) => {
      const a = base
        ? base + accessorToObjectAccess(accessors.slice(0, idx + 1))
        : accessors[0] + accessorToObjectAccess(accessors.slice(1, idx + 1));
      if (idx === accessors.length - 1) return a;
      if (idx === 0 && base === undefined)
        return `${a} = typeof ${a} === "object" ? ${a} : {}`;
      return `${a} = ${a} || {}`;
    })
    .join(joinWith);
};

/**
 * This plugin assumes that you are building for UMD, so we don't do any checking in the module graph
 * against each module to verify that it is of type UMD. We only care about externals
 */
module.exports = class UMDExternalOptimizerPlugin extends UmdTemplatePlugin {
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
        let rootNeedsUMDDecleration = false;
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
        this.modulesToExternalsMap = {};
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
              if (!this.modulesToExternalsMap[connection.originModule]) {
                this.modulesToExternalsMap[connection.originModule.request] = [external];
              } else {
                this.modulesToExternalsMap[connection.originModule.request] = this.modulesToExternalsMap[connection.originModule].push(external);
              }
            }
            /**
             * If we come across the "root" of the runtime module, then we need
             * to know so we can change the IIFE statement in that chunk so that
             * it can get the external it needs.
             */
            if (rootModules.includes(connection.originModule)) {
              rootModule = connection.originModule;
              rootNeedsUMDDecleration = true;
            }
          });
        });

        /**
         * For all modules that are part of the entry chunks tree, get only those that are dynamic imports
         */
        const entryModules = rootModules.filter((module) => module instanceof NormalModule);
        entryModules.forEach(entryModule => {
          moduleGraph.getOutgoingConnections(entryModule).forEach((module) => {
              /**
               * If the module that is a child of an entry module is not a dynamic import, we need to leave the
               * externals in the entry module, otherwise it will break the load of the page
               */
              if (!(module.dependency instanceof ImportDependency) && module.originModule.id === entryModule.id && this.modulesToExternalsMap[module.module.request]) {
                rootNeedsUMDDecleration = true;
                rootModule = entryModule;
                debugger;
                if (this.modulesToExternalsMap[entryModule.request]) {
                  this.modulesToExternalsMap[entryModule.request].push(this.modulesToExternalsMap[module.module.request]);
                } else {
                  this.modulesToExternalsMap[entryModule.request] = this.modulesToExternalsMap[module.module.request];
                }
                delete this.modulesToExternalsMap[module.module.request];
              };
          });
        })

        /**
         * The main chunk probably doesn't need a dependency unless one of the
         * entries is not dynamic and resides in the chunk.
         * If it does have an entry, we need to wrap it in a template correctly with just that external, not all of them
         */
        debugger;
        if (rootNeedsUMDDecleration) {
          // These are the externals that only the root module requires
          debugger;
          const rootExternals = this.modulesToExternalsMap[rootModule.request];

					/**
					 * This function constructs an array of named arguments for the IIFE that will map to each external in the bundle
					 * @param {Array} modules external modules to be declared
					 */
          const externalsArguments = modules => {
            return modules
              .map(
                m =>
                  `__WEBPACK_EXTERNAL_MODULE_${Template.toIdentifier(
                    `${chunkGraph.getModuleId(m)}`
                  )}__`
              )
              .join(", ");
          };

          /** @type {ExternalModule[]} */
          const optionalExternals = [];
          if (this.optionalAmdExternalAsGlobal) {
            for (const m of rootExternals) {
              if (m.isOptional(moduleGraph)) {
                optionalExternals.push(m);
              } else {
                rootExternals.push(m);
              }
            }
            rootExternals = rootExternals.concat(optionalExternals);
          }

          // Define the name of the AMD Factory if any exists
          let amdFactory = "factory";
          if (optionalExternals.length > 0) {
            const wrapperArguments = externalsArguments(rootExternals);
            const factoryArguments =
              rootExternals.length > 0
                ? externalsArguments(rootExternals) +
                ", " +
                externalsRootArray(rootExternals)
                : externalsRootArray(rootExternals);
            amdFactory =
              `function webpackLoadOptionalExternalModuleAmd(${wrapperArguments}) {\n` +
              `			return factory(${factoryArguments});\n` +
              "		}";
          } else {
            amdFactory = "factory";
          }
          /**
           * Gets the name of a given library
           * @param {String} library 
           */
          const libraryName = library => {
            return JSON.stringify(replaceKeys([].concat(library).pop()));
          };

          // Given a string, replace the string with the path of the given chunk
          const replaceKeys = str => {
            return compilation.getPath(str, {
              chunk
            });
          };

          /**
           * Given a list of external modules, get the array for AMD output
           * @param {Array} modules the external modules array for the entry chunk 
           */
          const externalsDepsArray = modules => {
            return `[${replaceKeys(
              modules
                .map(m =>
                  JSON.stringify(
                    typeof m.request === "object" ? m.request.amd : m.request
                  )
                )
                .join(", ")
            )}]`;
          };

          /**
           * This takes in the target type (cjs, amd, etc) and then returns the require string with the
           * library of the external module subbed in.
           * This code is copied from UMDTemplatePlugin out of Webpack's source code.
           * @param {String} type commonjs, amd, umd
           * @param {Array} externals the externals for the entry module (so we don't bloat the entry with unnecessary externals)
           */
          const externalsRequireArray = (type, externals) => {
            return replaceKeys(
              externals
                .map(m => {
                  let expr;
                  let request = m.request;
                  if (typeof request === "object") {
                    request = request[type];
                  }
                  if (request === undefined) {
                    throw new Error(
                      "Missing external configuration for type:" + type
                    );
                  }
                  if (Array.isArray(request)) {
                    expr = `require(${JSON.stringify(
                      request[0]
                    )})${accessorToObjectAccess(request.slice(1))}`;
                  } else {
                    expr = `require(${JSON.stringify(request)})`;
                  }
                  if (m.isOptional(moduleGraph)) {
                    expr = `(function webpackLoadOptionalExternalModule() { try { return ${expr}; } catch(e) {} }())`;
                  }
                  return expr;
                })
                .join(", ")
            );
          };

          /**
           * The array that will go in the root module that contains externals for that module
           * This root array is used by the `factory` defined in the UMD header below
           * @param {Array} modules 
           */
          const externalsRootArray = modules => {
            return replaceKeys(
              modules
                .map(m => {
                  let request = m.request;
                  if (typeof request === "object") request = request.root;
                  return `root${accessorToObjectAccess([].concat(request))}`;
                })
                .join(", ")
            );
          };

          // Help define any auxilary comments in the final output if necessary
          const auxiliaryComment = this.auxiliaryComment;
          const getAuxilaryComment = type => {
            if (auxiliaryComment) {
              if (typeof auxiliaryComment === "string")
                return "\t//" + auxiliaryComment + "\n";
              if (auxiliaryComment[type])
                return "\t//" + auxiliaryComment[type] + "\n";
            }
            return "";
          };

          /**
           * This logic will only strip out what is not external relative to the root module
           */
          externals.forEach((external) => {
            if (!rootExternals.includes(external)) {
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
            }
          })

          /**
           * This is the source that we will return to the compilation so that it gets written for the file
           * It should only include the externals that are declared in the entry chunk
           * 
           * The difference between this and the UmdTemplatePlugin is that we only look
           * at the external for the main chunk (entry). We don't consider all externals.
           */
          return new ConcatSource(
            new OriginalSource(
              "(function webpackUniversalModuleDefinition(root, factory) {\n" +
              getAuxilaryComment("commonjs2") +
              "	if(typeof exports === 'object' && typeof module === 'object')\n" +
              "		module.exports = factory(" +
              externalsRequireArray("commonjs2", rootExternals) +
              ");\n" +
              getAuxilaryComment("amd") +
              "	else if(typeof define === 'function' && define.amd)\n" +
              (rootExternals.length > 0
                ? this.names.amd && this.namedDefine === true
                  ? "		define(" +
                  libraryName(this.names.amd) +
                  ", " +
                  externalsDepsArray(rootExternals) +
                  ", " +
                  amdFactory +
                  ");\n"
                  : "		define(" +
                  externalsDepsArray(rootExternals) +
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
                externalsRequireArray("commonjs", rootExternals) +
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
                externalsRootArray(rootExternals) +
                ");\n"
                : "	else {\n" +
                (externals.length > 0
                  ? "		var a = typeof exports === 'object' ? factory(" +
                  externalsRequireArray("commonjs", rootExternals) +
                  ") : factory(" +
                  externalsRootArray(rootExternals) +
                  ");\n"
                  : "		var a = factory();\n") +
                "		for(var i in a) (typeof exports === 'object' ? exports : root)[i] = a[i];\n" +
                "	}\n") +
              `})(${
              runtimeTemplate.outputOptions.globalObject
              }, function(${externalsArguments(rootExternals)}) {\nreturn `,
              "webpack/universalModuleDefinition"
            ),
            source,
            ";\n})"
          )
        } else {
          debugger;
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

      /**
       * Tap into the renderModuleContainer function to get access to the module's container function for externals
       * For example, we want to get back
       * ((modules) => eval("module.exports = __WEBPACK_EXTERNAL_MODULE_..."))
       */
      hooks.renderModuleContainer.tap('UMDExternalOptimizerPlugin', (source, module, renderContext) => {
        // Store this information for later, and ensure it doesn't already exist so we don't override it
        this.renderedExternalModule = this.renderedExternalModule || {};
        // Only push modules to this mapping that are externals and UMD
        if (module instanceof ExternalModule &&
          (module.externalType === "umd" || module.externalType === "umd2")) {
          this.renderedExternalModule[module.request] = source;
        }
      });

      // For rendering the chunks
      hooks.renderChunk.tap('UMDExternalOptimizerPlugin', (source, { chunk, moduleGraph, chunkGraph, runtimeTemplate }) => {
        // An array of all modules in the given chunk
        const moduleRequestsInChunk = [];
        // Determine if this chunk requires any externals, otherwise we leave the source alone
        const modulesWithExternals = [];
        // Get the modules in the chunk, then filter them into their raw requests since we map those to externals
        chunkGraph.getChunkModules(chunk).forEach(module => {
          moduleRequestsInChunk.push(module.request);
        });
        // Used to determine if a chunk has externals associated with it.
        Object.keys(this.modulesToExternalsMap).forEach(request => {
          if (moduleRequestsInChunk.includes(request)) {
            modulesWithExternals.push(request)
          }
        })

        if (modulesWithExternals.length) {
          // These are the externals that only the root module requires
          let chunkExternals = [];
          modulesWithExternals.forEach(request => {
            // Create the canonical list of all externals for this chunk
            chunkExternals = chunkExternals.concat(this.modulesToExternalsMap[request])
          })

          /**
           * Given an array for the chunk, generate the module declaration that will cause the require
           * to execute the module requirement
           * @param {Array} externals externals for the given chunk
           */
          const generateExternalModuleBlock = externals => {
            const generatedModules = [];

            externals.forEach(external => {
              // Bookend each module with the request mapping. ex: `react: ((module) => ...)`
              generatedModules.push(`,\n\n/***/ \"${external.request}\":\n`);
              // Push the module onto the array of modules to be added to the source
              generatedModules.push(this.renderedExternalModule[external.request]);
            });
            return generatedModules;
          }

          // Inject the external modules for this chunk into the generated source code
          source.children.splice(source.children.length - 1, 0, ...generateExternalModuleBlock(chunkExternals));
          return source;
        }
      });
    });
    compiler.hooks.compilation.tap('UMDExternalOptimizerPlugin', compilation => {
      // Gets the hooks for creating javascript modules
      const hooks = JavascriptModulesPlugin.getCompilationHooks(compilation);
      // Gets the hooks for creating jsonp template function callback in the entry chunk
      const jsonpHooks = JsonpTemplatePlugin.getCompilationHooks(compilation);
      /**
       * Need to modify the JSONP template to ensure that the UMD define call at the top is executed
       * and then causes a callback which invokes the JSONP chunks
       */
      jsonpHooks.jsonpScript.tap('UMDExternalOptimizerPlugin', (source, chunk, hash) => {
          /**
           * This snippet of code is injected into the webpack bootstrapping code
           * It was contributed by @krohrsb
           * It causes the browser to wait on a callback, and if nothing returns within a minute it throws an error
           */
          const bootstrapWait = `var error = new Error();
onLoaded = function (evt) {
  var out = setTimeout(function () {
      clearTimeout(out);
      clearInterval(interval);
      // Check if the script has finished loading every minute
      onScriptComplete(evt);
  }, 60000)
  var interval = setInterval(function () {
      if (!loadingEnded()) {
      clearTimeout(out);
      clearInterval(interval);
      onScriptComplete(evt);
      }
  }, 200);
};`;

        source = source.replace(`var onScriptComplete;`, `var onScriptComplete, onLoaded;`);
        source = source.replace('var error = new Error();', bootstrapWait);
        source = source.replace('script.onerror = script.onload = onScriptComplete', 'script.onerror = script.onload = onLoaded');
        return source;
      })

      // For rendering the chunks
      hooks.renderChunk.tap('UMDExternalOptimizerPlugin', (source, { chunk, moduleGraph, chunkGraph, runtimeTemplate }) => {
        // An array of all modules in the given chunk
        const moduleRequestsInChunk = [];
        // Determine if this chunk requires any externals, otherwise we leave the source alone
        const modulesWithExternals = [];
        // Get the modules in the chunk, then filter them into their raw requests since we map those to externals
        chunkGraph.getChunkModules(chunk).forEach(module => {
          moduleRequestsInChunk.push(module.request);
        });
        // Used to determine if a chunk has externals associated with it.
        Object.keys(this.modulesToExternalsMap).forEach(request => {
          if (moduleRequestsInChunk.includes(request)) {
            modulesWithExternals.push(request)
          }
        })

        if (modulesWithExternals.length) {
          // These are the externals that only the root module requires
          let chunkExternals = [];
          modulesWithExternals.forEach(request => {
            // Create the canonical list of all externals for this chunk
            chunkExternals = chunkExternals.concat(this.modulesToExternalsMap[request])
          })

					/**
					 * This function constructs an array of named arguments for the IIFE that will map to each external in the bundle
					 * @param {Array} modules external modules to be declared
					 */
          const externalsArguments = modules => {
            return modules
              .map(
                m =>
                  `__WEBPACK_EXTERNAL_MODULE_${Template.toIdentifier(
                    `${chunkGraph.getModuleId(m)}`
                  )}__`
              )
              .join(", ");
          };

          /** @type {ExternalModule[]} */
          const optionalExternals = [];
          if (this.optionalAmdExternalAsGlobal) {
            for (const m of chunkExternals) {
              if (m.isOptional(moduleGraph)) {
                optionalExternals.push(m);
              } else {
                chunkExternals.push(m);
              }
            }
            chunkExternals = chunkExternals.concat(optionalExternals);
          }

          // Define the name of the AMD Factory if any exists
          let amdFactory = "factory";
          if (optionalExternals.length > 0) {
            const wrapperArguments = externalsArguments(chunkExternals);
            const factoryArguments =
              chunkExternals.length > 0
                ? externalsArguments(chunkExternals) +
                ", " +
                externalsRootArray(chunkExternals)
                : externalsRootArray(chunkExternals);
            amdFactory =
              `function webpackLoadOptionalExternalModuleAmd(${wrapperArguments}) {\n` +
              `			return factory(${factoryArguments});\n` +
              "		}";
          } else {
            amdFactory = "factory";
          }
          /**
           * Gets the name of a given library
           * @param {String} library 
           */
          const libraryName = library => {
            return JSON.stringify(replaceKeys([].concat(library).pop()));
          };

          // Given a string, replace the string with the path of the given chunk
          const replaceKeys = str => {
            return compilation.getPath(str, {
              chunk
            });
          };

          /**
           * Given a list of external modules, get the array for AMD output
           * @param {Array} modules the external modules array for the entry chunk 
           */
          const externalsDepsArray = modules => {
            return `[${replaceKeys(
              modules
                .map(m =>
                  JSON.stringify(
                    typeof m.request === "object" ? m.request.amd : m.request
                  )
                )
                .join(", ")
            )}]`;
          };

          /**
           * This takes in the target type (cjs, amd, etc) and then returns the require string with the
           * library of the external module subbed in.
           * This code is copied from UMDTemplatePlugin out of Webpack's source code.
           * @param {String} type commonjs, amd, umd
           * @param {Array} externals the externals for the entry module (so we don't bloat the entry with unnecessary externals)
           */
          const externalsRequireArray = (type, externals) => {
            return replaceKeys(
              externals
                .map(m => {
                  let expr;
                  let request = m.request;
                  if (typeof request === "object") {
                    request = request[type];
                  }
                  if (request === undefined) {
                    throw new Error(
                      "Missing external configuration for type:" + type
                    );
                  }
                  if (Array.isArray(request)) {
                    expr = `require(${JSON.stringify(
                      request[0]
                    )})${accessorToObjectAccess(request.slice(1))}`;
                  } else {
                    expr = `require(${JSON.stringify(request)})`;
                  }
                  if (m.isOptional(moduleGraph)) {
                    expr = `(function webpackLoadOptionalExternalModule() { try { return ${expr}; } catch(e) {} }())`;
                  }
                  return expr;
                })
                .join(", ")
            );
          };

          /**
           * The array that will go in the root module that contains externals for that module
           * This root array is used by the `factory` defined in the UMD header below
           * @param {Array} modules 
           */
          const externalsRootArray = modules => {
            return replaceKeys(
              modules
                .map(m => {
                  let request = m.request;
                  if (typeof request === "object") request = request.root;
                  return `root${accessorToObjectAccess([].concat(request))}`;
                })
                .join(", ")
            );
          };

          // Help define any auxilary comments in the final output if necessary
          const auxiliaryComment = this.auxiliaryComment;
          const getAuxilaryComment = type => {
            if (auxiliaryComment) {
              if (typeof auxiliaryComment === "string")
                return "\t//" + auxiliaryComment + "\n";
              if (auxiliaryComment[type])
                return "\t//" + auxiliaryComment[type] + "\n";
            }
            return "";
          };

          /**
           * Similar to how we handle the root chunk, we wrap the other chunks in an IIFE statement to have them fetch
           * and invoke externals that matter to them.
           */
          return new ConcatSource(
            new OriginalSource(
              "(function webpackUniversalModuleDefinition(root, factory) {\n" +
              getAuxilaryComment("commonjs2") +
              "	if(typeof exports === 'object' && typeof module === 'object')\n" +
              "		module.exports = factory(" +
              externalsRequireArray("commonjs2", chunkExternals) +
              ");\n" +
              getAuxilaryComment("amd") +
              "	else if(typeof define === 'function' && define.amd)\n" +
              (chunkExternals.length > 0
                ? this.names.amd && this.namedDefine === true
                  // For some reason, `define` does not fire the require callback so instead we use window.require which calls requirejs directly
                  ? "		window.require(" +
                  libraryName(this.names.amd) +
                  ", " +
                  externalsDepsArray(chunkExternals) +
                  ", " +
                  amdFactory +
                  ");\n"
                  : "		window.require(" +
                  externalsDepsArray(chunkExternals) +
                  ", " +
                  amdFactory +
                  ");\n"
                : this.names.amd && this.namedDefine === true
                  ? "		window.require(" +
                  libraryName(this.names.amd) +
                  ", [], " +
                  amdFactory +
                  ");\n"
                  : "		window.require([], " + amdFactory + ");\n") +
              (this.names.root || this.names.commonjs
                ? getAuxilaryComment("commonjs") +
                "	else if(typeof exports === 'object')\n" +
                "		exports[" +
                libraryName(this.names.commonjs || this.names.root) +
                "] = factory(" +
                externalsRequireArray("commonjs", chunkExternals) +
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
                externalsRootArray(chunkExternals) +
                ");\n"
                : "	else {\n" +
                (chunkExternals.length > 0
                  ? "		var a = typeof exports === 'object' ? factory(" +
                  externalsRequireArray("commonjs", chunkExternals) +
                  ") : factory(" +
                  externalsRootArray(chunkExternals) +
                  ");\n"
                  : "		var a = factory();\n") +
                "		for(var i in a) (typeof exports === 'object' ? exports : root)[i] = a[i];\n" +
                "	}\n") +
              `})(${
              runtimeTemplate.outputOptions.globalObject
              }, function(${externalsArguments(chunkExternals)}) {\nreturn `,
              "webpack/universalModuleDefinition",
            ),
            source,
            ";\n})"
          )
        } else {
          // If we have no externals associated with this chunk, we just return it as is.
          return source;
        }
      });
    })
  }
}