'use strict';

// The only bridge between the chat window and the rest of the app.
// The window never sees your API key; it just asks the main process to do things.

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function subscribe(channel, callback) {
  const handler = (_event, data) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('buddy', {
  init: () => invoke('app:init'),
  saveSettings: (patch) => invoke('settings:save', patch),
  setApiKey: (key) => invoke('key:set', key),
  clearApiKey: () => invoke('key:clear'),

  listChats: (query) => invoke('conv:list', query),
  getChat: (id) => invoke('conv:get', id),
  renameChat: (id, title) => invoke('conv:rename', id, title),
  deleteChat: (id) => invoke('conv:delete', id),
  deleteAllChats: () => invoke('conv:deleteAll'),

  addAttachment: (file) => invoke('att:add', file),
  removeAttachment: (id) => invoke('att:remove', id),

  send: (payload) => invoke('chat:send', payload),
  regenerate: (payload) => invoke('chat:regenerate', payload),
  edit: (payload) => invoke('chat:edit', payload),
  stop: (convId) => invoke('chat:stop', convId),

  openExternal: (url) => invoke('shell:open', url),
  copy: (text) => invoke('clipboard:write', text),
  revealData: () => invoke('data:reveal'),

  onEvent: (callback) => subscribe('chat:event', callback),
  onMenu: (callback) => subscribe('menu', callback),
});
