module.exports = async function cloudRunner(req, res) {
  const { default: handler } = await import('../terminal_dev_console/api/cloud-runner.js')
  return handler(req, res)
}
