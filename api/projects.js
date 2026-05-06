module.exports = async function projects(req, res) {
  const { default: handler } = await import('../terminal_dev_console/api/projects.js')
  return handler(req, res)
}
