/**
 * chatService.js — barrel.
 *
 * Реализация разнесена по ./chat/*.js по областям; здесь только реэкспорт,
 * чтобы внешние импортеры (`require('../services/chatService')`) не менялись.
 *   queries.js      — getChatById, getUserChats (общий read-слой)
 *   create.js       — создание чатов (group / direct / saved)
 *   prefs.js        — pin / mute / порядок закрепления
 *   members.js      — участники, роли, жизненный цикл группы, инфо группы
 *   teardown.js     — удаление ЛС / аккаунта
 *   backgrounds.js  — фоны чата (личный / общий)
 *
 * Зависимости направлены в одну сторону (chat/* → messageService/userService/
 * chatPermissions), цикла нет.
 */
const { getChatById, getUserChats } = require('./chat/queries');
const { createGroupChat, getOrCreateDirectChat, getOrCreateSavedChat } = require('./chat/create');
const { togglePinChat, toggleMuteChat, updateChatPinOrder } = require('./chat/prefs');
const {
  markChatAsRead, addChatMember, removeChatMember, leaveGroup, closeGroup,
  transferAdmin, updateChatMetadata, setMemberRole, setMemberPermissions,
} = require('./chat/members');
const { deleteDirectChat, deleteAccount } = require('./chat/teardown');
const { setChatBackground } = require('./chat/backgrounds');

module.exports = {
  getUserChats,
  getChatById,
  setChatBackground,
  getOrCreateDirectChat,
  getOrCreateSavedChat,
  createGroupChat,
  markChatAsRead,
  addChatMember,
  removeChatMember,
  leaveGroup,
  closeGroup,
  transferAdmin,
  deleteDirectChat,
  updateChatMetadata,
  deleteAccount,
  togglePinChat,
  toggleMuteChat,
  updateChatPinOrder,
  setMemberRole,
  setMemberPermissions,
};
