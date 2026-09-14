/** Source-level localization: React owns the translated tree; no DOM mutation or remote runtime translation. */
module.exports = function ({ types: t }) {
  function clean(text) {
    const lines = text.split(/\r\n|\n|\r/)
    let last = 0
    for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i])) last = i
    return lines.map((line, i) => {
      let part = line.replace(/\t/g, ' ')
      if (i !== 0) part = part.replace(/^ +/, '')
      if (i !== lines.length - 1) part = part.replace(/ +$/, '')
      return part && i !== last ? part + ' ' : part
    }).join('')
  }
  const tag = node => t.isJSXIdentifier(node) ? node.name : ''
  function protectedPath(path) {
    return !!path.findParent(parent => parent.isJSXElement() && ['pre', 'code', 'script', 'style'].includes(tag(parent.node.openingElement.name)))
  }
  function call(state, name, value) {
    state.used.add(name)
    return t.callExpression(t.identifier(`__sizeof_${name}`), [value])
  }
  const userFields = /^(notes|tags|firstError|hardwareLabel|runtimeVersion|workload|prompt|modelId|revision|filename|name|id|path|repositoryId|sourceModelId|publisher|owner|device|modelRevision|quantization|before|after|left|right)$/
  function localizeExpression(expression, state) {
    if ((t.isMemberExpression(expression) || t.isOptionalMemberExpression(expression)) && t.isIdentifier(expression.property)) {
      if (userFields.test(expression.property.name)) return expression
      if (expression.property.name === 'label' && t.isIdentifier(expression.object) && /profile/i.test(expression.object.name)) return expression
    }
    if (t.isIdentifier(expression) && /^(notes|tags|firstError|workload|prompt|device|filename|revision)$/.test(expression.name)) return expression
    if (t.isLogicalExpression(expression)) {
      // A condition is not displayed; a fallback branch can contain localized site prose.
      if (expression.operator !== '&&') expression.left = localizeExpression(expression.left, state)
      expression.right = localizeExpression(expression.right, state)
      return expression
    }
    if (t.isConditionalExpression(expression)) {
      expression.consequent = localizeExpression(expression.consequent, state)
      expression.alternate = localizeExpression(expression.alternate, state)
      return expression
    }
    return call(state, 'localizeNode', expression)
  }
  return {
    visitor: {
      Program: {
        enter(path, state) { state.enabled = /\/src\/.*\.tsx?$/.test(state.filename || '') && !/\/(?:i18n|test)\/|\.test\.tsx?$/.test(state.filename); state.used = new Set() },
        exit(path, state) {
          if (!state.used.size) return
          path.unshiftContainer('body', t.importDeclaration([...state.used].map(name => t.importSpecifier(t.identifier(`__sizeof_${name}`), t.identifier(name))), t.stringLiteral('/src/i18n/core.ts')))
        },
      },
      JSXElement: {
        enter(path, state) {
          if (!state.enabled || protectedPath(path)) return
          const opening = path.node.openingElement
          if (tag(opening.name) === 'option' && !opening.attributes.some(a => t.isJSXAttribute(a) && tag(a.name) === 'value')) {
            const children = path.node.children.filter(child => !t.isJSXText(child) || clean(child.value).trim())
            if (children.length === 1) {
              const child = children[0]
              if (t.isJSXText(child)) opening.attributes.push(t.jsxAttribute(t.jsxIdentifier('value'), t.stringLiteral(clean(child.value))))
              else if (t.isJSXExpressionContainer(child)) opening.attributes.push(t.jsxAttribute(t.jsxIdentifier('value'), t.jsxExpressionContainer(t.cloneNode(child.expression, true))))
            }
          }
        },
      },
      JSXText(path, state) {
        if (!state.enabled || protectedPath(path)) return
        const text = clean(path.node.value)
        if (text.trim()) path.replaceWith(t.jsxExpressionContainer(call(state, 'translate', t.stringLiteral(text))))
        path.skip()
      },
      JSXExpressionContainer: {
        exit(path, state) {
          if (!state.enabled || protectedPath(path) || !path.parentPath.isJSXElement()) return
          const expression = path.node.expression
          if (t.isJSXEmptyExpression(expression) || t.isCallExpression(expression) && t.isIdentifier(expression.callee) && expression.callee.name.startsWith('__sizeof_')) return
          path.node.expression = localizeExpression(expression, state)
        },
      },
      JSXAttribute(path, state) {
        if (!state.enabled || protectedPath(path)) return
        const name = tag(path.node.name)
        const href = name === 'href'
        if (!href && !['aria-label', 'aria-description', 'aria-valuetext', 'title', 'alt', 'placeholder', 'label'].includes(name)) return
        const value = path.node.value
        if (!value) return
        const expression = t.isStringLiteral(value) ? value : t.isJSXExpressionContainer(value) ? value.expression : null
        if (expression && !t.isJSXEmptyExpression(expression)) path.node.value = t.jsxExpressionContainer(call(state, href ? 'localizeHref' : 'localizeNode', expression))
      },
      CallExpression(path, state) {
        if (!state.enabled) return
        const callee = path.node.callee
        if (t.isMemberExpression(callee) && t.isIdentifier(callee.object, { name: 'window' }) && t.isIdentifier(callee.property, { name: 'confirm' })) {
          if (path.node.arguments[0] && !t.isSpreadElement(path.node.arguments[0])) path.node.arguments[0] = call(state, 'translate', path.node.arguments[0])
          path.skip()
        }
        if (t.isMemberExpression(callee) && t.isIdentifier(callee.property, { name: 'writeText' })) {
          const value = path.node.arguments[0]
          if (value && !t.isSpreadElement(value) && !(t.isIdentifier(value) && /^(code|command)$/.test(value.name))) {
            path.node.arguments[0] = call(state, 'localizeOutput', value)
            path.skip()
          }
        }
        if (t.isMemberExpression(callee) && t.isIdentifier(callee.property, { name: 'replaceState' })
          && t.isMemberExpression(callee.object) && t.isIdentifier(callee.object.property, { name: 'history' })) {
          const value = path.node.arguments[2]
          if (value && !t.isSpreadElement(value) && !t.isNullLiteral(value)) {
            path.node.arguments[2] = call(state, 'localizeHref', value)
            path.skip()
          }
        }
      },
      NewExpression(path, state) {
        if (!state.enabled || !t.isIdentifier(path.node.callee, { name: 'Blob' })) return
        const [contents, options] = path.node.arguments
        if (!t.isArrayExpression(contents) || !t.isObjectExpression(options)) return
        const type = options.properties.find(property => t.isObjectProperty(property) && t.isIdentifier(property.key, { name: 'type' }))
        if (!type || !t.isStringLiteral(type.value) || !/^text\/(?:plain|markdown)/.test(type.value.value)) return
        contents.elements = contents.elements.map(value => value && !t.isSpreadElement(value) ? call(state, 'localizeOutput', value) : value)
        path.skip()
      },
      MemberExpression(path, state) {
        if (!state.enabled) return
        const node = path.node
        if (t.isIdentifier(node.property, { name: 'search' }) && t.isMemberExpression(node.object)
          && t.isIdentifier(node.object.property, { name: 'location' }) && t.isIdentifier(node.object.object, { name: 'window' })) {
          path.replaceWith(call(state, 'routingSearch', t.cloneNode(node, true)))
          path.skip()
        }
      },
    },
  }
}
