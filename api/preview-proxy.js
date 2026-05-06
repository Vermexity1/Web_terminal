module.exports = async function previewProxy(req, res) {
  const { default: handler } = await import('../terminal_dev_console/api/preview-proxy.js')
  return handler(req, res)
}
