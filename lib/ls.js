'use strict'

// BREAKING CHANGES:
//
// - extraneous deps depth will be flattened to current location
// - will mark deps as extraneous when missing a package.json

const archy = require('archy')
const chalk = require('chalk')
const Arborist = require('@npmcli/arborist')
const { breadth } = require('treeverse')

const npm = require('./npm.js')
const usageUtil = require('./utils/usage.js')
const completion = require('./utils/completion/installed-deep.js')
const output = require('./utils/output.js')

const _depth = Symbol('depth')
const dedupe = Symbol('dedupe')
const _include = Symbol('include')
const parent = Symbol('parent')

const usage = usageUtil(
  'ls',
  'npm ls [[<@scope>/]<pkg> ...]'
)

const cmd = (args, cb) => ls(args).then(() => cb()).catch(cb)

const getHumanOutputItem = (node, color) => {
  const { extraneous, pkgid, path } = node
  let printable = pkgid

  // special formatting for top-level package name
  if (node.isRoot) {
    const hasNoPackageJson = !Object.keys(node.package).length
    if (hasNoPackageJson) {
      printable = path
    } else {
      printable += ` ${path}`
    }
  }

  const label = `${printable}` +
    (node[dedupe] ? ' deduped' : '') +
    (extraneous
      ? (color ? chalk.green.bgBlack(' extraneous') : ' extraneous')
      : ''
    )
  const problem =
    extraneous
      ? `extraneous: ${pkgid} ${path}`
      : ''

  return {
    label,
    problem
  }
}

const shouldInclude = (node) =>
  spec => {
    if (node.pkgid === spec || node.name === spec) {
      let p = node[parent]
      while (p) {
        p[_include] = true
        p = p[parent]
      }
      return true
    }
  }

const ls = async (args) => {
  const path = npm.prefix
  const arb = new Arborist({ path })
  const tree = await arb.loadActual()
  const { color, depth, unicode } = npm.flatOptions
  const seen = new Set()
  const problems = new Set()
  tree[_depth] = 0

  const result = breadth({
    tree,
    visit (node) {
      seen.add(node)

      const { label, problem } = getHumanOutputItem(node, color)
      const item = { label, nodes: [] }

      if (problem) {
        problems.add(problem)
      }

      if (node[_include] && node[parent]) {
        node[parent].nodes.push(item)
      }

      return item
    },
    getChildren (node, nodeResult) {
      return (!(node instanceof Arborist.Node) || node[_depth] > depth)
        ? []
        : [...node.edgesOut.values()]
          .map(i => i.to)
          // append extraneous children since they won't be in edgesOut
          .concat([...node.children.values()]
            .filter(i => i.extraneous)
          )
          .map(i => {
            if (seen.has(i)) {
              i = {
                pkgid: i.pkgid,
                package: i.package,
                [dedupe]: true
              }
            }
            i[parent] = nodeResult
            i[_include] = args.length === 0 ? true : args.some(shouldInclude(i))
            i[_depth] = nodeResult[_depth] + 1
            return i
          })
          .sort((a, b) => a.name.localeCompare(b.name))
    }
  })

  if (!result.nodes.length) {
    result.nodes = ['(empty)']
    process.exitCode = 1
  }

  output(archy(result, '', { unicode }))

  if (problems.size) {
    throw Object.assign(
      new Error([...problems].join('\n')),
      { code: 'EBADLS' }
    )
  }
}

module.exports = Object.assign(cmd, { usage, completion })
