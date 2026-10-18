'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { GlobalNav } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { useCart } from '@/lib/cart/CartContext';
import type { AccessoryProduct, ColorSwatch } from './data/types';

interface Props {
  product: AccessoryProduct;
}

export function AccessoryDetailPage({ product }: Props) {
  const { addItem } = useCart();
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);
  const [activeImage, setActiveImage] = useState(0);
  const [showStickyBar, setShowStickyBar] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [showPickupModal, setShowPickupModal] = useState(false);
  const [pincode, setPincode] = useState('400001');
  const [isAddingToBag, setIsAddingToBag] = useState(false);
  const [isAdded, setIsAdded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [isProductInfoOpen, setIsProductInfoOpen] = useState(true);
  const [isCompatibilityOpen, setIsCompatibilityOpen] = useState(true);

  const hasColors = product.colors.length > 0;
  const currentColor: ColorSwatch =
    product.colors[selectedColorIndex] ??
    product.colors[0] ?? { name: product.subtitle, hex: '#1d1d1f' };

  const gallery = product.images.length > 0 ? product.images : [product.image];
  const mainImage = gallery[activeImage] ?? product.image;

  // Sticky Bar visibility on scroll
  useEffect(() => {
    const handleScroll = () => {
      setShowStickyBar(window.scrollY > 380);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleAddToBag = () => {
    setIsAddingToBag(true);

    addItem({
      productId: product.id,
      name: product.name,
      subtitle: hasColors ? currentColor.name : product.subtitle,
      price: product.price,
      priceDisplay: product.priceDisplay,
      image: mainImage,
      color: hasColors ? currentColor.name : undefined,
      model: product.compatibility[0],
      quantity: 1,
      href: `/shop/product/${encodeURIComponent(product.id)}`,
    });

    setTimeout(() => {
      setIsAddingToBag(false);
      setIsAdded(true);
      setTimeout(() => {
        setIsAdded(false);
      }, 3000);
    }, 200);
  };

  const stickyMeta = hasColors ? currentColor.name : product.subtitle;

  return (
    <div className="min-h-screen bg-[#fff] text-[#1d1d1f] font-sans antialiased selection:bg-[#0071e3] selection:text-white">
      {/* Global Navigation */}
      <GlobalNav bannerVisible={false} />

      {/* Sticky Secondary Action Bar (Appears when scrolling past hero).
          Sits directly under the sticky GadzioHeader: 56px tall below `anav`,
          96px from `anav` up once the secondary link strip appears. When
          hidden it slides up behind the header, which shares the same top
          edge and has a higher z-index. */}
      <div
        className={`fixed left-0 right-0 top-14 anav:top-24 z-40 bg-white/85 backdrop-blur-md border-b border-[#e5e5ea] transition-all duration-300 ${
          showStickyBar ? 'opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-semibold text-sm truncate">{product.name}</span>
            <span className="text-xs text-[#86868b] hidden sm:inline">• {stickyMeta}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-semibold text-sm text-[#1d1d1f]">{product.priceDisplay}</span>
            <button
              type="button"
              onClick={handleAddToBag}
              className={`text-xs font-semibold px-5 py-2 rounded-xl transition-all active:scale-95 shadow-sm cursor-pointer ${
                isAdded ? 'bg-[#34c759] text-white' : 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
              }`}
            >
              {isAdded ? 'Added ✓' : 'Add to Bag'}
            </button>
          </div>
        </div>
      </div>

      {/* Breadcrumb Strip */}
      <div className="border-b border-[#e5e5ea] bg-[#fff]">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-3 text-xs text-[#86868b] flex items-center gap-2 overflow-x-auto whitespace-nowrap">
          <Link href="/" className="hover:text-[#1d1d1f] transition">Store</Link>
          <span>›</span>
          <Link href="/in/shop/iphone/accessories/cases-protection" className="hover:text-[#1d1d1f] transition">Accessories</Link>
          <span>›</span>
          <Link
            href={`/in/shop/iphone/accessories/${product.categorySlug}`}
            className="hover:text-[#1d1d1f] transition"
          >
            {product.category}
          </Link>
          <span>›</span>
          <span className="text-[#1d1d1f] font-medium">{product.name}</span>
        </div>
      </div>

      {/* Main Buy Flow: 2 Columns */}
      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-10 lg:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">

          {/* Left Column: Visual Product Stage */}
          <div className="lg:col-span-7 flex flex-col items-center">
            {/* Main Stage Frame */}
            <div className="relative w-full aspect-square bg-[#f5f5f7] rounded-[28px] overflow-hidden flex items-center justify-center p-8 sm:p-12 transition-all duration-300">
              {imgError ? (
                <div className="flex flex-col items-center justify-center text-center text-[#6e6e73] px-6">
                  <span className="text-lg font-semibold text-[#1d1d1f] mb-1">{product.brand}</span>
                  <span className="text-sm">{product.name}</span>
                </div>
              ) : (
                <img
                  src={mainImage}
                  alt={`${product.name}${hasColors ? ` in ${currentColor.name}` : ''}`}
                  className="max-h-full max-w-full object-contain filter drop-shadow-lg select-none transition-all duration-500"
                  onError={() => setImgError(true)}
                />
              )}
            </div>

            {/* Gallery Thumbnails */}
            {gallery.length > 1 && (
              <div className="flex items-center gap-2.5 mt-5">
                {gallery.map((img, idx) => (
                  <button
                    key={img + idx}
                    type="button"
                    onClick={() => {
                      setActiveImage(idx);
                      setImgError(false);
                    }}
                    className={`w-16 h-16 rounded-xl bg-[#f5f5f7] border overflow-hidden flex items-center justify-center p-2 transition-all ${
                      idx === activeImage ? 'border-[#0071e3] ring-1 ring-[#0071e3]' : 'border-[#e5e5ea] hover:border-[#86868b]'
                    }`}
                    aria-label={`View image ${idx + 1}`}
                  >
                    <img src={img} alt="" className="max-h-full max-w-full object-contain" />
                  </button>
                ))}
              </div>
            )}

            {/* Micro Feature Highlights — first three product highlights */}
            {product.highlights.length > 0 && (
              <div className="grid grid-cols-3 gap-3 sm:gap-3.5 w-full mt-5">
                {product.highlights.slice(0, 3).map((hl) => (
                  <div
                    key={hl.title}
                    className="group relative bg-[#f5f5f7]/80 hover:bg-white border border-[#e5e5ea] hover:border-[#0071e3]/40 rounded-2xl p-3.5 text-center transition-all duration-300 hover:shadow-xs"
                  >
                    <div className="w-10 h-10 mx-auto rounded-full bg-white shadow-2xs border border-black/5 flex items-center justify-center text-[#0071e3] group-hover:scale-105 group-hover:bg-[#0071e3]/10 transition-all duration-300 mb-2.5">
                      <svg className="w-5 h-5 text-[#0071e3]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <circle cx="12" cy="12" r="9" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 12.2l2.4 2.4 4.6-4.8" />
                      </svg>
                    </div>
                    <span className="text-xs sm:text-[13px] font-semibold text-[#1d1d1f] block tracking-tight leading-tight">
                      {hl.title}
                    </span>
                    <span className="text-[11px] sm:text-[11.5px] text-[#86868b] block mt-1 font-normal leading-tight">
                      {hl.desc}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Buying Sidebar */}
          <div className="lg:col-span-5 flex flex-col">
            {/* Header Titles */}
            <div className="mb-6">
              <span className="text-xs font-semibold text-[#86868b] uppercase tracking-wider block mb-1">
                {product.brand}
              </span>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#1d1d1f] leading-tight mb-2">
                {product.name}
              </h1>
              <p className="text-sm text-[#86868b]">{product.category}</p>
            </div>

            {/* Price Row */}
            <div className="pb-6 border-b border-[#e5e5ea] mb-6">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1d1d1f]">
                  {product.priceDisplay}
                </span>
                <span className="text-xs text-[#86868b]">Includes all applicable taxes</span>
              </div>
            </div>

            {/* Finish / Color Picker */}
            {hasColors && (
              <div className="mb-6">
                <div className="flex justify-between items-baseline mb-3">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#1d1d1f]">
                    Finish — <span className="text-[#0071e3]">{currentColor.name}</span>
                  </label>
                  <span className="text-xs text-[#86868b]">
                    {product.colors.length} {product.colors.length === 1 ? 'option' : 'options'}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  {product.colors.map((color, idx) => (
                    <button
                      key={color.name}
                      type="button"
                      onClick={() => setSelectedColorIndex(idx)}
                      className={`group relative flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                        idx === selectedColorIndex
                          ? 'border-[#0071e3] bg-[#0071e3]/5 text-[#1d1d1f] ring-1 ring-[#0071e3]'
                          : 'border-[#d2d2d7] hover:border-[#86868b] text-[#6e6e73]'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-black/10 shrink-0 shadow-xs"
                        style={{ backgroundColor: color.hex }}
                      />
                      <span>{color.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Compatible-with chip row */}
            {product.compatibility.length > 0 && (
              <div className="mb-6">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#1d1d1f] block mb-3">
                  Compatible With
                </span>
                <div className="flex flex-wrap gap-2">
                  {product.compatibility.map((c) => (
                    <span
                      key={c}
                      className="px-3 py-1.5 rounded-full bg-[#f5f5f7] border border-[#e5e5ea] text-xs text-[#1d1d1f]"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Divider Line */}
            <div className="border-t border-[#d2d2d7] mb-6" />

            {/* Delivery Section */}
            <div className="flex items-start gap-4 mb-5">
              <div className="mt-0.5 text-[#1d1d1f] shrink-0">
                <svg className="w-6 h-6 text-[#1d1d1f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.25">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6.5A1.5 1.5 0 014.5 5h8A1.5 1.5 0 0114 6.5v9.5H3V6.5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 9h3.764a1.5 1.5 0 011.341.83l1.58 3.158A1.5 1.5 0 0121 13.682V16H14V9z" />
                  <circle cx="6.5" cy="17.5" r="2" stroke="currentColor" strokeWidth="1.25" />
                  <circle cx="17.5" cy="17.5" r="2" stroke="currentColor" strokeWidth="1.25" />
                  <path strokeLinecap="round" d="M8.5 16h7M3 16h1.5M19.5 16H21" />
                </svg>
              </div>
              <div className="text-[14px] leading-[1.45]">
                <div className="font-semibold text-[#1d1d1f]">Delivery:</div>
                <div className="text-[#1d1d1f]">In Stock</div>
                <div className="text-[#1d1d1f]">Free Shipping</div>
                <button
                  type="button"
                  onClick={() => setShowDeliveryModal(true)}
                  className="text-[#0071e3] hover:underline inline-flex items-center gap-1.5 mt-1 font-normal cursor-pointer group"
                >
                  <span>Get delivery dates</span>
                  <svg className="w-4 h-4 text-[#0071e3] group-hover:scale-110 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v8M8 12h8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Pickup Section */}
            <div className="flex items-start gap-4 mb-7">
              <div className="mt-0.5 text-[#1d1d1f] shrink-0">
                <svg className="w-6 h-6 text-[#1d1d1f]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 7.5V6a3 3 0 016 0v1.5" />
                  <rect x="4.5" y="7.5" width="15" height="13" rx="2" />
                </svg>
              </div>
              <div className="text-[14px] leading-[1.45]">
                <div className="font-semibold text-[#1d1d1f]">Pickup:</div>
                <button
                  type="button"
                  onClick={() => setShowPickupModal(true)}
                  className="text-[#0071e3] hover:underline inline-flex items-center gap-1.5 mt-1 font-normal cursor-pointer group"
                >
                  <span>Check availability</span>
                  <svg className="w-4 h-4 text-[#0071e3] group-hover:scale-110 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v8M8 12h8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Add to Bag Button */}
            <button
              type="button"
              onClick={handleAddToBag}
              disabled={isAddingToBag}
              className={`w-full py-3.5 rounded-xl text-[15px] font-semibold transition-all active:scale-[0.99] shadow-sm mb-3 flex items-center justify-center cursor-pointer ${
                isAdded
                  ? 'bg-[#34c759] text-white'
                  : 'bg-[#0071e3] hover:bg-[#0077ed] active:bg-[#0066cc] text-white'
              }`}
            >
              {isAdded ? (
                <span className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Added to Bag</span>
                </span>
              ) : isAddingToBag ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Adding to Bag...</span>
                </span>
              ) : (
                <span>Add to Bag</span>
              )}
            </button>

            {/* Added Confirmation Banner */}
            {isAdded && (
              <div className="mb-5 p-3.5 rounded-xl bg-[#f0fdf4] border border-[#22c55e]/30 flex items-center justify-between animate-in fade-in duration-200">
                <span className="text-xs text-[#15803d] font-semibold flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-[#15803d]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Item added to your Bag!
                </span>
                <div className="flex items-center gap-2.5">
                  <Link href="/cart" className="text-xs font-semibold text-[#0071e3] hover:underline">
                    Review Bag
                  </Link>
                  <span className="text-[#86868b] text-[10px]">•</span>
                  <Link
                    href="/checkout"
                    className="text-xs font-semibold text-[#0071e3] hover:underline flex items-center gap-0.5"
                  >
                    <span>Check Out</span>
                    <span>→</span>
                  </Link>
                </div>
              </div>
            )}

            {/* Need a moment? Section */}
            <div className="mt-4 pt-1">
              <h4 className="font-semibold text-[13px] text-[#1d1d1f] mb-1">Need a moment?</h4>
              <p className="text-[13px] text-[#1d1d1f] leading-normal mb-2.5 max-w-sm">
                Keep all your selections by saving this item to Saved Items, then come back anytime and pick up right where you left off.
              </p>
              <button
                type="button"
                onClick={() => setIsSaved(!isSaved)}
                className="inline-flex items-center text-[13px] text-[#0071e3] hover:underline cursor-pointer font-normal"
              >
                <svg
                  className="w-4 h-4 mr-1.5 shrink-0"
                  fill={isSaved ? '#0071e3' : 'none'}
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="1.75"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                </svg>
                <span>{isSaved ? 'Saved to Saved Items ✓' : 'Save for later'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Collapsible Sections: Product Information & Compatibility */}
        <section className="mt-20 pt-8 border-t border-[#d2d2d7]">
          {/* Section 1: Product Information */}
          <div className="pb-8">
            <button
              type="button"
              onClick={() => setIsProductInfoOpen(!isProductInfoOpen)}
              className="w-full flex items-center justify-between text-left py-2 group cursor-pointer focus:outline-none"
              aria-expanded={isProductInfoOpen}
            >
              <h2 className="text-xl sm:text-[22px] font-semibold text-[#1d1d1f] tracking-tight">
                Product Information
              </h2>
              <span className="text-[#6e6e73] group-hover:text-[#1d1d1f] transition-colors">
                <svg
                  className={`w-5 h-5 transition-transform duration-200 ${isProductInfoOpen ? 'rotate-180' : 'rotate-0'}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>

            {isProductInfoOpen && (
              <div className="mt-8 transition-opacity duration-200">
                {/* Overview Row */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-y-4 md:gap-x-8">
                  <div className="md:col-span-3 lg:col-span-3">
                    <h3 className="text-[15px] sm:text-[16px] font-semibold text-[#1d1d1f]">Overview</h3>
                  </div>
                  <div className="md:col-span-9 lg:col-span-9 max-w-3xl space-y-4 text-[13.5px] sm:text-[14px] leading-[1.65] text-[#1d1d1f]">
                    <p>{product.description}</p>
                    {product.highlights.length > 0 && (
                      <ul className="space-y-2.5 pt-1">
                        {product.highlights.map((hl) => (
                          <li key={hl.title} className="flex items-start gap-2.5">
                            <svg className="w-4 h-4 mt-0.5 text-[#0071e3] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            <span>
                              <span className="font-semibold">{hl.title}.</span> {hl.desc}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Inner divider */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-y-4 md:gap-x-8 my-8 sm:my-10">
                  <div className="hidden md:block md:col-span-3 lg:col-span-3" aria-hidden="true" />
                  <div className="md:col-span-9 lg:col-span-9">
                    <div className="border-t border-[#e5e5ea]" />
                  </div>
                </div>

                {/* Specifications Row */}
                {product.specs.length > 0 && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-y-4 md:gap-x-8">
                      <div className="md:col-span-3 lg:col-span-3">
                        <h3 className="text-[15px] sm:text-[16px] font-semibold text-[#1d1d1f]">Specifications</h3>
                      </div>
                      <div className="md:col-span-9 lg:col-span-9 max-w-3xl text-[13.5px] sm:text-[14px] text-[#1d1d1f]">
                        <dl className="divide-y divide-[#e5e5ea]">
                          {product.specs.map((spec) => (
                            <div key={spec.label} className="flex justify-between gap-6 py-2.5">
                              <dt className="text-[#6e6e73]">{spec.label}</dt>
                              <dd className="font-medium text-right">{spec.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    </div>

                    {/* Inner divider */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-y-4 md:gap-x-8 my-8 sm:my-10">
                      <div className="hidden md:block md:col-span-3 lg:col-span-3" aria-hidden="true" />
                      <div className="md:col-span-9 lg:col-span-9">
                        <div className="border-t border-[#e5e5ea]" />
                      </div>
                    </div>
                  </>
                )}

                {/* What's In the Box Row */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-y-4 md:gap-x-8">
                  <div className="md:col-span-3 lg:col-span-3">
                    <h3 className="text-[15px] sm:text-[16px] font-semibold text-[#1d1d1f]">What’s in the Box</h3>
                  </div>
                  <div className="md:col-span-9 lg:col-span-9 text-[13.5px] sm:text-[14px] leading-[1.65] text-[#1d1d1f]">
                    <ul className="space-y-1.5">
                      {product.inTheBox.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Full-width Divider */}
          <div className="border-t border-[#d2d2d7]" />

          {/* Section 2: Compatibility */}
          <div className="py-8">
            <button
              type="button"
              onClick={() => setIsCompatibilityOpen(!isCompatibilityOpen)}
              className="w-full flex items-center justify-between text-left py-2 group cursor-pointer focus:outline-none"
              aria-expanded={isCompatibilityOpen}
            >
              <h2 className="text-xl sm:text-[22px] font-semibold text-[#1d1d1f] tracking-tight">
                Compatibility
              </h2>
              <span className="text-[#6e6e73] group-hover:text-[#1d1d1f] transition-colors">
                <svg
                  className={`w-5 h-5 transition-transform duration-200 ${isCompatibilityOpen ? 'rotate-180' : 'rotate-0'}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>

            {isCompatibilityOpen && (
              <div className="mt-8 transition-opacity duration-200">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-y-4 md:gap-x-8">
                  <div className="hidden md:block md:col-span-3 lg:col-span-3" aria-hidden="true" />
                  <div className="md:col-span-9 lg:col-span-9">
                    <h3 className="text-[14px] sm:text-[15px] font-semibold text-[#1d1d1f] mb-1.5">
                      Works With
                    </h3>
                    <div className="text-[13.5px] sm:text-[14px] text-[#1d1d1f] space-y-1">
                      {product.compatibility.map((c) => (
                        <p key={c}>{c}</p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Full-width Bottom Divider */}
          <div className="border-t border-[#d2d2d7]" />

          {/* Trademark Notice */}
          <div className="py-8 text-xs text-[#86868b] leading-relaxed max-w-3xl">
            <p>
              All third-party product names, logos, and brands are the property of their respective owners.
              Gadzio accessories are independently designed and engineered for device compatibility, and are
              not affiliated with, sponsored by, or endorsed by those companies.
            </p>
          </div>
        </section>
      </main>

      {/* Delivery Dates Modal */}
      {showDeliveryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#e5e5ea] relative">
            <button
              onClick={() => setShowDeliveryModal(false)}
              className="absolute top-4 right-4 text-[#86868b] hover:text-[#1d1d1f] w-8 h-8 rounded-full bg-[#f5f5f7] flex items-center justify-center text-sm"
              aria-label="Close modal"
            >
              ✕
            </button>
            <h3 className="text-lg font-semibold text-[#1d1d1f] mb-2">Delivery Options</h3>
            <p className="text-xs text-[#6e6e73] mb-4">
              Enter your PIN code to check exact delivery dates for {product.name}.
            </p>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={pincode}
                maxLength={6}
                onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter 6-digit PIN code"
                className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#d2d2d7] text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
              />
              <button
                type="button"
                className="bg-[#1d1d1f] text-white text-xs font-semibold px-4 py-2.5 rounded-xl hover:bg-black transition"
              >
                Check
              </button>
            </div>
            <div className="bg-[#f5f5f7] rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex justify-between font-medium">
                <span>Standard Delivery:</span>
                <span className="text-emerald-700 font-semibold">FREE (2-3 Business Days)</span>
              </div>
              <div className="flex justify-between text-[#6e6e73]">
                <span>Carrier:</span>
                <span>BlueDart / Delhivery Express</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pickup Availability Modal */}
      {showPickupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#e5e5ea] relative">
            <button
              onClick={() => setShowPickupModal(false)}
              className="absolute top-4 right-4 text-[#86868b] hover:text-[#1d1d1f] w-8 h-8 rounded-full bg-[#f5f5f7] flex items-center justify-center text-sm"
              aria-label="Close modal"
            >
              ✕
            </button>
            <h3 className="text-lg font-semibold text-[#1d1d1f] mb-2">Store Pickup</h3>
            <p className="text-xs text-[#6e6e73] mb-4">
              Pick up your order today at a Gadzio Experience Center.
            </p>
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50 flex justify-between items-center text-xs">
                <div>
                  <strong className="block text-[#1d1d1f]">Gadzio Dispatch Centre, Bhiwandi</strong>
                  <span className="text-[#6e6e73]">Maharashtra • Open until 10:00 PM</span>
                </div>
                <span className="font-semibold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-md">Available Today</span>
              </div>
              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50 flex justify-between items-center text-xs">
                <div>
                  <strong className="block text-[#1d1d1f]">Gadzio Dispatch Centre, Gurugram</strong>
                  <span className="text-[#6e6e73]">Haryana • Open until 10:00 PM</span>
                </div>
                <span className="font-semibold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-md">Available Today</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global Footer */}
      <GlobalFooter />
    </div>
  );
}
