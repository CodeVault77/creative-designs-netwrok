/**
 * P2 navigation shell.
 *
 * AppShell is the only one most code should need; TabBar, NavRail and TopBar
 * are exported for Storybook and for the rare screen that composes its own
 * chrome (the editor in P5).
 */
export { AppShell, type AppShellProps } from './AppShell';
export { TabBar, TAB_BAR_HEIGHT } from './TabBar';
export { NavRail, RAIL_WIDTH, railVariantFor, type RailVariant } from './NavRail';
export { TopBar, TOP_BAR_HEIGHT, type TopBarProps } from './TopBar';
export { ScreenScaffold, type ScreenScaffoldProps } from './ScreenScaffold';
export { Icon, type IconName } from './Icon';
export { NAV_ITEMS, type NavItem } from './navItems';
