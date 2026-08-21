import { SEARCH_PANEL } from './data/nav';
import { SearchArrowIcon, SearchResetIcon, SearchSubmitIcon } from './icons';

/**
 * Contents of the search flyout (height 388px at >=834px).
 *
 * Measured: content `padding: 32px 22px 80px`; a 980px field row 40px tall with
 * the magnifier at the left and the clear button at the right, the input itself
 * at 24px; "Quick Links" heading 32px below the field; rows 24px tall with
 * `padding: 4px 8px`, `border-radius: 5px` and a 9x16 arrow 11px before the label.
 */
export function NavSearchPanel() {
  return (
    <div className="mx-auto max-w-[1024px] px-[22px] pt-[32px] pb-[80px]">
      <form action="/us/search" method="get" className="block">
        <div className="flex h-[40px] items-center">
          <button
            type="submit"
            aria-label="Submit search"
            tabIndex={-1}
            className="relative -ml-[6px] flex h-[31px] w-[30px] shrink-0 items-center justify-center text-[#1d1d1f]"
          >
            <SearchSubmitIcon />
          </button>
          <input
            type="text"
            placeholder={SEARCH_PANEL.placeholder}
            aria-label={SEARCH_PANEL.placeholder}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            className="h-[40px] grow bg-transparent pt-[1px] text-[24px] text-[#333336] outline-none placeholder:text-[#333336]"
          />
          <button
            type="button"
            aria-label="Clear search"
            tabIndex={-1}
            className="relative flex h-[32px] w-[30px] shrink-0 items-center justify-center py-[2px] text-[#1d1d1f]"
          >
            <SearchResetIcon />
          </button>
        </div>
      </form>

      <div className="mt-[32px]">
        <h2 className="text-[12px] leading-[16.0005px] tracking-[-0.12px] text-[#6e6e73]">
          {SEARCH_PANEL.quickLinksHeading}
        </h2>
        <ul className="mt-[8px] block">
          {SEARCH_PANEL.quickLinks.map((link) => (
            <li key={link.href} className="block">
              <a href={link.href} className="ac-search-quicklink -mx-[8px] flex items-start">
                <span className="mr-[11px] flex h-[16px] w-[9px] shrink-0 items-center">
                  <SearchArrowIcon />
                </span>
                <span className="text-[12px] leading-[16.0005px] tracking-[-0.12px]">{link.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
