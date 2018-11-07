'use strict';
const fs = require('fs-extra');
const Path = require('path');
const parseModuleName = require('./lib/parse-module-name');

module.exports = function(babel) {
  let t = babel.types;

  function compileTemplate(precompile, template) {
    let options = {
      contents: template
    }

    let compiledTemplateString = `Ember.HTMLBars.template(${precompile(template, options)})`;
    return compiledTemplateString;
  }

  // TODO: Extract only if project is addon
  function extractInlineTemplatesForPrebuild(path, state, template) {
    let fileName = state.file.opts.filename;
    // Create hbs file name from e.g, From 'addon/components/my-component.js' to 'my-component134166'
    fileName =  Path.basename(fileName, Path.extname(fileName));
    // Appending node.start and end to create a new hbs file for every inline-template present in a js file (if any).
    fileName = fileName + path.node.start + path.node.end;

    // The extracted hbs file should be imported in the my-component.js file.
    // Since the extracted template file belongs to the app. The import statement will be from dummy app of the addon
    let extractedTemplatePath = `dummy/templates/${fileName}`;
    // TODO: Change file.addImport to addDefault for babel 7
    // Add the import statement at the top of the js file in code.
    let importName = state.file.addImport(extractedTemplatePath, "default", fileName).name;
    // Replace the inline-template hbs call with imported moduleName. The importName contains the moduleName of the import statement
    path.replaceWithSourceString(importName);

    // Store the extracted inline-templates in `<my-addon>/extracted-templates/templates/` directory
    // An example file path will be `<my-addon>/extracted-templates/templates/my-component124166.hbs`
    let extractedTemplateActualpath = `${process.cwd()}/extracted-templates/templates/${fileName}.hbs`;
    if(!fs.existsSync(`${process.cwd()}/extracted-templates/`)) {
      fs.mkdirpSync(`${process.cwd()}/extracted-templates/templates`);
    }
    fs.writeFileSync(extractedTemplateActualpath, template);
  }


  return {
    visitor: {
      ImportDeclaration(path, state) {
        let node = path.node;

        let modulePaths = state.opts.modulePaths || ["htmlbars-inline-precompile"];
        let matchingModulePath = modulePaths.find(value => t.isLiteral(node.source, { value }));

        if (matchingModulePath) {
          let first = node.specifiers && node.specifiers[0];
          if (!t.isImportDefaultSpecifier(first)) {
            let input = state.file.code;
            let usedImportStatement = input.slice(node.start, node.end);
            let msg = `Only \`import hbs from '${matchingModulePath}'\` is supported. You used: \`${usedImportStatement}\``;
            throw path.buildCodeFrameError(msg);
          }

          state.importId = state.importId || path.scope.generateUidIdentifierBasedOnNode(path.node.id);
          path.scope.rename(first.local.name, state.importId.name);
          path.remove();
        }
      },

      TaggedTemplateExpression(path, state) {
        if (!state.importId) { return; }

        let tagPath = path.get('tag');
        if (tagPath.node.name !== state.importId.name) {
          return;
        }

        if (path.node.quasi.expressions.length) {
          throw path.buildCodeFrameError("placeholders inside a tagged template string are not supported");
        }

        let template = path.node.quasi.quasis.map(quasi => quasi.value.cooked).join('');

        let options = {
          meta: {}
        }

        let filename = state.file.opts.filename;
        let moduleName = parseModuleName(filename);

        if (moduleName) {
          options.meta.moduleName = moduleName;
        }

        if (process.env.PREBUILD) {
          extractInlineTemplatesForPrebuild(path, state, template);
        } else {
          path.replaceWithSourceString(compileTemplate(state.opts.precompile, template, filename));
        }
      },

      CallExpression(path, state) {
        if (!state.importId) { return; }

        let calleePath = path.get('callee');
        if (calleePath.node.name !== state.importId.name) {
          return;
        }

        let argumentErrorMsg = "hbs should be invoked with a single argument: the template string";
        if (path.node.arguments.length !== 1) {
          throw path.buildCodeFrameError(argumentErrorMsg);
        }

        let template = path.node.arguments[0].value;
        if (typeof template !== "string") {
          throw path.buildCodeFrameError(argumentErrorMsg);
        }

        if (process.env.PREBUILD) {
          extractInlineTemplatesForPrebuild(path, state, template);
        } else {
          path.replaceWithSourceString(compileTemplate(state.opts.precompile, template, state.file.opts.filename));
        }
      },
    }
  };
};

module.exports._parallelBabel = {
  requireFile: __filename
};

module.exports.baseDir = function() {
  return __dirname;
};
