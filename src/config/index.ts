/**
 * The configuration surface, in one import.
 *
 * Components import from '@/config' rather than reaching into individual
 * files, so the set of things that are configurable stays visible in one
 * place — the same reason '@/components/ui' has a barrel.
 */
export { site, isPreLaunch, type SiteConfig, type LaunchStatus } from './site';
export {
  contact,
  hasEmail,
  hasWhatsApp,
  whatsappUrl,
  emailUrl,
  type ContactConfig,
} from './contact';
export {
  headerNav,
  footerNav,
  socialLinks,
  enabled,
  type NavItem,
} from './navigation';
export {
  services,
  activeServices,
  featuredServices,
  serviceById,
  serviceOptions,
  budgetOptions,
  timelineOptions,
  projectTypeOptions,
  heardFromOptions,
  type Service,
} from './services';
export { flags, type Flags } from './flags';
export { seo, pageMetadata, type SeoConfig } from './seo';
