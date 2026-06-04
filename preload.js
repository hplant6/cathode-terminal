const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cathode', {
  // Terminal
  sendInput:    (data)         => ipcRenderer.send('pty-input', data),
  sendResize:   (cols, rows)   => ipcRenderer.send('pty-resize', { cols, rows }),
  restartPty:   ()             => ipcRenderer.send('pty-restart'),
  onOutput:     (cb)           => ipcRenderer.on('pty-output', (_, data) => cb(data)),

  // Browser
  navigate:        (url) => ipcRenderer.send('browser-navigate', url),
  goBack:          ()    => ipcRenderer.send('browser-go-back'),
  goForward:       ()    => ipcRenderer.send('browser-go-forward'),
  reload:          ()    => ipcRenderer.send('browser-reload'),
  toggleDevTools:  ()    => ipcRenderer.send('browser-toggle-devtools'),
  navigateHome:    ()    => ipcRenderer.send('browser-navigate-home'),
  onUrlChanged:    (cb)  => ipcRenderer.on('browser-url-changed', (_, url) => cb(url)),

  // Layout
  splitChanged:  (fraction) => ipcRenderer.send('split-changed', fraction),
  rendererReady: ()         => ipcRenderer.send('renderer-ready'),
});
