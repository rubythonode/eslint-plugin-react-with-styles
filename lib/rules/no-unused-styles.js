'use strict';

const has = require('has');

const findImportCSSFromWithStylesImportDeclaration = require('../util/findImportCSSFromWithStylesImportDeclaration');
const findRequireCSSFromWithStylesCallExpression = require('../util/findRequireCSSFromWithStylesCallExpression');

function getBasicIdentifier(node) {
  if (node.type === 'Identifier') {
    // styles.foo
    return node.name;
  } else if (node.type === 'Literal') {
    // styles['foo']
    return node.value;
  } else if (node.type === 'TemplateLiteral') {
    // styles[`foo`]
    if (node.expressions.length) {
      // styles[`foo${bar}`]
      return null;
    }
    return node.quasis[0].value.raw;
  }

  // Might end up here with thigs like:
  // styles['foo' + bar]
  return null;
}

module.exports = {
  meta: {
    docs: {
      description: 'Require that all styles that are defined are also referenced in the same file',
      recommended: false, // TODO add to recommended for next major release
    },

    schema: [],
  },

  create: function rule(context) {
    // If `css()` is imported by this file, we want to store what it is imported
    // as in this variable so we can verify where it is used.
    let cssFromWithStylesName;

    const usedStyles = {};
    const definedStyles = {};

    function isCSSFound() {
      return !!cssFromWithStylesName;
    }

    return {
      CallExpression(node) {
        const found = findRequireCSSFromWithStylesCallExpression(node);
        if (found !== null) {
          cssFromWithStylesName = found;
        }

        // foo()
        if (!isCSSFound()) {
          // We are not importing `css` from withStyles, so we have no work to
          // do here.
          return;
        }

        if (node.callee.name === 'withStyles') {
          const styles = node.arguments[0];

          if (styles && styles.type === 'ArrowFunctionExpression') {
            const body = styles.body;

            let stylesObj;
            if (body.type === 'ObjectExpression') {
              stylesObj = body;
            } else if (body.type === 'BlockStatement') {
              body.body.forEach((bodyNode) => {
                if (
                  bodyNode.type === 'ReturnStatement' &&
                  bodyNode.argument.type === 'ObjectExpression'
                ) {
                  stylesObj = bodyNode.argument;
                }
              });
            }

            if (stylesObj) {
              stylesObj.properties.forEach((property) => {
                if (property.computed) {
                  // Skip over computed properties for now.
                  // e.g. `{ [foo]: { ... } }`
                  // TODO handle this better?
                  return;
                }

                if (property.type === 'ExperimentalSpreadProperty') {
                  // Skip over object spread for now.
                  // e.g. `{ ...foo }`
                  // TODO handle this better?
                  return;
                }

                definedStyles[property.key.name] = property;
              });
            }
          }

          // Now we know all of the defined styles and used styles, so we can
          // see if there are any defined styles that are not used.
          Object.keys(definedStyles).forEach((definedStyleKey) => {
            if (!has(usedStyles, definedStyleKey)) {
              context.report(
                definedStyles[definedStyleKey],
                `Style \`${definedStyleKey}\` is unused`
              );
            }
          });
        }
      },

      MemberExpression(node) {
        if (!isCSSFound()) {
          // We are not importing `css` from withStyles, so we have no work to
          // do here.
          return;
        }

        if (node.object.type === 'Identifier' && node.object.name === 'styles') {
          const style = getBasicIdentifier(node.property);
          if (style) {
            usedStyles[style] = true;
          }
          return;
        }

        const stylesIdentifier = getBasicIdentifier(node.property);
        if (!stylesIdentifier) {
          // props['foo' + bar].baz
          return;
        }

        if (stylesIdentifier !== 'styles') {
          // props.foo.bar
          return;
        }

        const parent = node.parent;

        if (parent.type !== 'MemberExpression') {
          // foo.styles
          return;
        }

        if (node.object.object && node.object.object.type !== 'ThisExpression') {
          // foo.foo.styles
          return;
        }

        const propsIdentifier = getBasicIdentifier(parent.object);
        if (propsIdentifier && propsIdentifier !== 'props') {
          return;
        }
        if (!propsIdentifier && parent.object.type !== 'MemberExpression') {
          return;
        }

        if (parent.parent.type === 'MemberExpression') {
          // this.props.props.styles
          return;
        }

        const style = getBasicIdentifier(parent.property);
        if (style) {
          usedStyles[style] = true;
        }
      },

      ImportDeclaration(node) {
        if (isCSSFound()) {
          // We've already found it, so there is no more work to do.
          return;
        }

        const found = findImportCSSFromWithStylesImportDeclaration(node);
        if (found !== null) {
          cssFromWithStylesName = found;
        }
      },
    };
  },
};
