module.exports = async function auth(req, res) {
  const { default: handler } = await import('../terminal_dev_console/api/auth.js')
  return handler(req, res)
}
