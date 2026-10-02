/**
 * The city's own Facebook posts, shown with Facebook's official Page embed. Nothing is copied or
 * stored by the portal: the embed loads straight from Facebook each time the page is opened.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';

const PAGE_URL = 'https://www.facebook.com/vineyardcity';

export function CityFacebook() {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.clientWidth / 10) * 10);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Facebook allows 180 to 500 pixels wide.
  const each = Math.max(180, Math.min(500, width - 16));
  const src = `https://www.facebook.com/plugins/page.php?${new URLSearchParams({ href: PAGE_URL, tabs: 'timeline', width: String(each), height: '720', small_header: 'true', adapt_container_width: 'true', hide_cover: 'true', show_facepile: 'false' })}`;
  return (
    <div ref={box} className="vc-feeds">
      <div className="vc-feed">
        {width > 0 && <iframe title="Vineyard City on Facebook" src={src} width={each} height={720} loading="lazy" allow="encrypted-media" referrerPolicy="strict-origin-when-cross-origin" />}
        <a href={PAGE_URL} target="_blank" rel="noopener noreferrer" className="vc-feed-open">
          Open Vineyard City on Facebook <ArrowUpRight size={13} />
        </a>
      </div>
    </div>
  );
}
