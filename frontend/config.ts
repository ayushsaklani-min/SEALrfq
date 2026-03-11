// =============================================================================
// SealRFQ Site Configuration
// Zero-knowledge procurement platform built on Aleo
// Edit ONLY this file to customize all content across the site.
// =============================================================================

// -- Site-wide settings -------------------------------------------------------
export interface SiteConfig {
  title: string;
  description: string;
  language: string;
}

export const siteConfig: SiteConfig = {
  title: "SealRFQ - Zero-Knowledge Procurement",
  description: "The future of private procurement. Zero-knowledge bidding, verifiable results, complete confidentiality. Built on Aleo's privacy-first blockchain.",
  language: "en",
};

// -- Hero Section -------------------------------------------------------------
export interface HeroNavItem {
  label: string;
  sectionId: string;
  icon: "disc" | "play" | "calendar" | "music";
}

export interface HeroConfig {
  backgroundImage: string;
  brandName: string;
  decodeText: string;
  decodeChars: string;
  subtitle: string;
  ctaPrimary: string;
  ctaPrimaryTarget: string;
  ctaSecondary: string;
  ctaSecondaryTarget: string;
  cornerLabel: string;
  cornerDetail: string;
  navItems: HeroNavItem[];
}

export const heroConfig: HeroConfig = {
  backgroundImage: "/images/hero-bg.jpg",
  brandName: "SealRFQ",
  decodeText: "Zero-knowledge bidding",
  decodeChars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*",
  subtitle: "Verifiable results. Complete confidentiality.",
  ctaPrimary: "Request Demo",
  ctaPrimaryTarget: "contact",
  ctaSecondary: "Read Docs",
  ctaSecondaryTarget: "features",
  cornerLabel: "PRIVATE PROCUREMENT",
  cornerDetail: "Built on Aleo",
  navItems: [
    { label: "Product", sectionId: "cube", icon: "disc" },
    { label: "Security", sectionId: "features", icon: "play" },
    { label: "Use Cases", sectionId: "gallery", icon: "calendar" },
    { label: "Pricing", sectionId: "contact", icon: "music" },
  ],
};

// -- Album Cube Section (Seal Cube) -------------------------------------------
export interface Album {
  id: number;
  title: string;
  subtitle: string;
  image: string;
}

export interface AlbumCubeConfig {
  albums: Album[];
  cubeTextures: string[];
  scrollHint: string;
}

export const albumCubeConfig: AlbumCubeConfig = {
  albums: [
    { id: 1, title: "Commit", subtitle: "SEAL", image: "/images/cube-1.jpg" },
    { id: 2, title: "Reveal", subtitle: "CUBE", image: "/images/cube-2.jpg" },
    { id: 3, title: "Settle", subtitle: "LOCK", image: "/images/cube-3.jpg" },
    { id: 4, title: "Verify", subtitle: "TRUST", image: "/images/cube-4.jpg" },
  ],
  cubeTextures: [
    "/images/cube-1.jpg",
    "/images/cube-2.jpg",
    "/images/cube-3.jpg",
    "/images/cube-4.jpg",
    "/images/cube-5.jpg",
    "/images/cube-6.jpg",
  ],
  scrollHint: "Drag to rotate",
};

// -- Parallax Gallery Section (Use Cases) -------------------------------------
export interface ParallaxImage {
  id: number;
  src: string;
  alt: string;
}

export interface GalleryImage {
  id: number;
  src: string;
  title: string;
  date: string;
}

export interface ParallaxGalleryConfig {
  sectionLabel: string;
  sectionTitle: string;
  galleryLabel: string;
  galleryTitle: string;
  marqueeTexts: string[];
  endCtaText: string;
  parallaxImagesTop: ParallaxImage[];
  parallaxImagesBottom: ParallaxImage[];
  galleryImages: GalleryImage[];
}

export const parallaxGalleryConfig: ParallaxGalleryConfig = {
  sectionLabel: "USE CASES",
  sectionTitle: "Who it's for",
  galleryLabel: "INDUSTRIES",
  galleryTitle: "Real-world applications",
  marqueeTexts: [
    "ENTERPRISE PROCUREMENT",
    "GOVERNMENT TENDERS",
    "VENDOR AUCTIONS",
    "SUPPLY CHAIN RFQs",
    "ZERO-KNOWLEDGE BIDDING",
  ],
  endCtaText: "Explore all use cases",
  parallaxImagesTop: [
    { id: 1, src: "/images/usecase-enterprise.jpg", alt: "Enterprise" },
    { id: 2, src: "/images/usecase-government.jpg", alt: "Government" },
    { id: 3, src: "/images/usecase-vendor.jpg", alt: "Vendor" },
    { id: 4, src: "/images/usecase-creative.jpg", alt: "Creative" },
    { id: 5, src: "/images/usecase-supply.jpg", alt: "Supply Chain" },
    { id: 6, src: "/images/privacy-bg.jpg", alt: "Privacy" },
  ],
  parallaxImagesBottom: [
    { id: 1, src: "/images/trust-bg.jpg", alt: "Trust" },
    { id: 2, src: "/images/fairness-bg.jpg", alt: "Fairness" },
    { id: 3, src: "/images/cube-1.jpg", alt: "Seal" },
    { id: 4, src: "/images/cube-2.jpg", alt: "Lock" },
    { id: 5, src: "/images/cube-3.jpg", alt: "Key" },
    { id: 6, src: "/images/cube-4.jpg", alt: "Crypto" },
  ],
  galleryImages: [
    { id: 1, src: "/images/usecase-enterprise.jpg", title: "Enterprise Procurement", date: "High-value sourcing" },
    { id: 2, src: "/images/usecase-government.jpg", title: "Government Tenders", date: "Compliance-ready" },
    { id: 3, src: "/images/usecase-vendor.jpg", title: "Vendor Auctions", date: "Sealed fairness" },
    { id: 4, src: "/images/usecase-creative.jpg", title: "Creative Bidding", date: "Private pitches" },
    { id: 5, src: "/images/usecase-supply.jpg", title: "Supply Chain", date: "Strategic RFQs" },
    { id: 6, src: "/images/privacy-bg.jpg", title: "Healthcare", date: "Medical sourcing" },
  ],
};

// -- Tour Schedule Section (How It Works) -------------------------------------
export interface TourDate {
  id: number;
  date: string;
  time: string;
  city: string;
  venue: string;
  status: "on-sale" | "sold-out" | "coming-soon";
  image: string;
}

export interface TourStatusLabels {
  onSale: string;
  soldOut: string;
  comingSoon: string;
  default: string;
}

export interface TourScheduleConfig {
  sectionLabel: string;
  sectionTitle: string;
  vinylImage: string;
  buyButtonText: string;
  detailsButtonText: string;
  bottomNote: string;
  bottomCtaText: string;
  statusLabels: TourStatusLabels;
  tourDates: TourDate[];
}

export const tourScheduleConfig: TourScheduleConfig = {
  sectionLabel: "HOW IT WORKS",
  sectionTitle: "Three steps to confidential RFQ",
  vinylImage: "/images/cube-5.jpg",
  buyButtonText: "Learn More",
  detailsButtonText: "View Details",
  bottomNote: "Built on Aleo. Private by design.",
  bottomCtaText: "Read the whitepaper",
  statusLabels: {
    onSale: "Active",
    soldOut: "Live",
    comingSoon: "Soon",
    default: "Pending",
  },
  tourDates: [
    {
      id: 1,
      date: "PHASE 01",
      time: "COMMIT",
      city: "Sealed Bidding",
      venue: "Buyers publish requirements. Bidders submit encrypted commitments. No one sees the numbers.",
      status: "on-sale",
      image: "/images/cube-1.jpg",
    },
    {
      id: 2,
      date: "PHASE 02",
      time: "REVEAL",
      city: "Fair Selection",
      venue: "After deadline, bidders reveal. Smart contract verifies lowest valid bid without exposing others.",
      status: "on-sale",
      image: "/images/cube-2.jpg",
    },
    {
      id: 3,
      date: "PHASE 03",
      time: "SETTLE",
      city: "Automated Escrow",
      venue: "Funds move on-chain via milestones. Auditable. Irreversible. No intermediary required.",
      status: "coming-soon",
      image: "/images/cube-3.jpg",
    },
  ],
};

// -- Footer Section -----------------------------------------------------------
export interface FooterImage {
  id: number;
  src: string;
}

export interface SocialLink {
  icon: "instagram" | "twitter" | "youtube" | "music";
  label: string;
  href: string;
}

export interface FooterQuickLink {
  label: string;
  href: string;
}

export interface FooterConfig {
  portraitImage: string;
  portraitAlt: string;
  heroTitle: string;
  heroSubtitle: string;
  artistLabel: string;
  artistName: string;
  artistSubtitle: string;
  brandName: string;
  brandDescription: string;
  quickLinksTitle: string;
  quickLinks: FooterQuickLink[];
  contactTitle: string;
  emailLabel: string;
  email: string;
  phoneLabel: string;
  phone: string;
  addressLabel: string;
  address: string;
  newsletterTitle: string;
  newsletterDescription: string;
  newsletterButtonText: string;
  subscribeAlertMessage: string;
  copyrightText: string;
  bottomLinks: string[];
  socialLinks: SocialLink[];
  galleryImages: FooterImage[];
}

export const footerConfig: FooterConfig = {
  portraitImage: "/images/footer-bg.jpg",
  portraitAlt: "SealRFQ Abstract",
  heroTitle: "Ready to seal your next RFQ?",
  heroSubtitle: "Talk to our team and run a private pilot.",
  artistLabel: "CONTACT",
  artistName: "SealRFQ",
  artistSubtitle: "Zero-knowledge procurement",
  brandName: "SealRFQ",
  brandDescription: "The world's first zero-knowledge RFQ platform. Built on Aleo's privacy-first blockchain.",
  quickLinksTitle: "Quick Links",
  quickLinks: [
    {
      label: "Documentation",
      href: "https://docs.google.com/document/d/1qirTHcNsSpZDk4yQJJjhS7UFis4TQ9Pe/edit?pli=1",
    },
  ],
  contactTitle: "Contact",
  emailLabel: "Email",
  email: "hello@sealrfq.io",
  phoneLabel: "Support",
  phone: "Documentation",
  addressLabel: "Network",
  address: "Aleo Mainnet",
  newsletterTitle: "",
  newsletterDescription: "",
  newsletterButtonText: "",
  subscribeAlertMessage: "",
  copyrightText: "© 2026 SealRFQ. All rights reserved.",
  bottomLinks: ["Privacy Policy", "Terms of Service", "Cookie Policy"],
  socialLinks: [],
  galleryImages: [
    { id: 1, src: "/images/cube-1.jpg" },
    { id: 2, src: "/images/cube-2.jpg" },
    { id: 3, src: "/images/cube-3.jpg" },
    { id: 4, src: "/images/cube-4.jpg" },
  ],
};

// -- Additional Value Props (for extra pinned sections) -----------------------
export interface ValuePropConfig {
  sectionId: string;
  backgroundImage: string;
  microLabel: string;
  headline: string;
  bottomLeft: string;
  bottomRight: string;
}

export const valuePropsConfig: ValuePropConfig[] = [
  {
    sectionId: "privacy",
    backgroundImage: "/images/privacy-bg.jpg",
    microLabel: "CONFIDENTIALITY",
    headline: "No one can see your bid",
    bottomLeft: "SEALRFQ",
    bottomRight: "Scroll",
  },
  {
    sectionId: "fairness",
    backgroundImage: "/images/fairness-bg.jpg",
    microLabel: "FAIRNESS",
    headline: "Lowest bid wins. Every time.",
    bottomLeft: "SEALRFQ",
    bottomRight: "Scroll",
  },
  {
    sectionId: "trust",
    backgroundImage: "/images/trust-bg.jpg",
    microLabel: "TRUST",
    headline: "Built on Aleo. Private by design.",
    bottomLeft: "SEALRFQ",
    bottomRight: "Scroll",
  },
];
