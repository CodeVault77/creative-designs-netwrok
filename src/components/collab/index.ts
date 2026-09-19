/**
 * Collaboration (§15) — chat, presence, activity, notifications.
 */
export { ChatPanel, type ChatPanelProps } from './ChatPanel';
export { MessageBubble, type MessageBubbleProps } from './MessageBubble';
export { Composer, type ComposerProps, type ComposerNode } from './Composer';
export { PresenceStack, type PresenceStackProps } from './PresenceStack';
export {
  NotificationRow,
  relativeTime,
  type NotificationRowProps,
  type NotificationItem,
} from './NotificationRow';
export { NotificationsScreen } from './NotificationsScreen';
export { ActivityPanel } from './ActivityPanel';
