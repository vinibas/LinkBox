import { ref } from 'vue';

export interface PageMetadata {
    title: string;
    description: string;
    image: string;
}

const corsProxies = [
    (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

export async function fetchViaProxy(url: string): Promise<Response> {
    try {
        const res = await fetch(url);
        if (res.ok) return res;
    } catch { /* CORS or network error — try proxies */ }

    for (const buildProxy of corsProxies) {
        try {
            const res = await fetch(buildProxy(url));
            if (res.ok) return res;
        } catch { /* try next */ }
    }

    throw new Error('Nenhum proxy conseguiu buscar a página');
}

async function fetchOEmbedFromDoc(doc: Document): Promise<PageMetadata | null> {
    try {
        const oembedLink = doc.querySelector(
            'link[type="application/json+oembed"]',
        ) as HTMLLinkElement | null;
        if (!oembedLink?.href) return null;

        const res = await fetch(oembedLink.href);
        if (!res.ok) return null;
        const data = await res.json();
        return {
            title: data.title ?? '',
            description: data.description ?? '',
            image: data.thumbnail_url ?? '',
        };
    } catch {
        return null;
    }
}

async function fetchOEmbedFromService(url: string): Promise<PageMetadata | null> {
    try {
        const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.error) return null;
        return {
            title: data.title ?? '',
            description: data.description ?? '',
            image: data.thumbnail_url ?? '',
        };
    } catch {
        return null;
    }
}

function isMetadataUseful(meta: PageMetadata): boolean {
    return !!(meta.title && (meta.description || meta.image));
}

export function useMetadataFetch() {
    const loading = ref(false);
    const error = ref('');

    async function fetchMetadata(url: string): Promise<PageMetadata | null> {
        loading.value = true;
        error.value = '';

        try {
            const res = await fetchViaProxy(url);
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const meta = parseMetadataFromDoc(doc, url);
            if (isMetadataUseful(meta)) return meta;

            const oembed = await fetchOEmbedFromDoc(doc)
                ?? await fetchOEmbedFromService(url);
            if (oembed) return oembed;

            return meta;
        } catch (e: any) {
            error.value = e.message || 'Erro ao buscar metadados';
            return null;
        } finally {
            loading.value = false;
        }
    }

    return { fetchMetadata, loading, error };
}

function parseMetadataFromDoc(doc: Document, baseUrl: string): PageMetadata {
    const getMeta = (attr: string, value: string): string => {
        const el = doc.querySelector(`meta[${attr}="${value}"]`) as HTMLMetaElement | null;
        return el?.content?.trim() ?? '';
    };

    const title =
        getMeta('property', 'og:title') ||
        getMeta('name', 'title') ||
        doc.querySelector('title')?.textContent?.trim() ||
        '';

    const description =
        getMeta('property', 'og:description') ||
        getMeta('name', 'description') ||
        '';

    let image =
        getMeta('property', 'og:image') ||
        getMeta('name', 'twitter:image') ||
        '';

    if (image && !image.startsWith('http')) {
        try {
            image = new URL(image, baseUrl).href;
        } catch { /* ignore */ }
    }

    return { title, description, image };
}
