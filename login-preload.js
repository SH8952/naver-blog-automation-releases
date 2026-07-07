const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__NBA', {
  loginDone: () => ipcRenderer.send('naver:login-done'),
});
