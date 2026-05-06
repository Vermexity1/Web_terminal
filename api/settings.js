module.exports = async function settings(req, res) {
  const { default: handler } = await import('../terminal_dev_console/api/settings.js')
  return handler(req, res)
}
