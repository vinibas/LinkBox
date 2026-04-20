import { ref } from 'vue';
import JSZip from 'jszip';
import type { Box } from '@/models/Box';
import { db } from '@/db';
import { fetchViaProxy } from '@/composables/useMetadataFetch';

const MAX_IMAGE_SIZE = 500 * 1024; // 500 KB

const MIME_TO_EXT: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
};

const EXT_TO_MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    avif: 'image/avif',
};

function isZipBuffer(buf: ArrayBuffer): boolean {
    if (buf.byteLength < 4) return false;
    const b = new Uint8Array(buf, 0, 4);
    return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

const links = ref<Box[]>([]);

async function loadFromDB() {
    links.value = await db.links.orderBy('createdAt').reverse().toArray();
}

loadFromDB();

export function useLinksStorage() {
    async function addLink(link: Omit<Box, 'id' | 'createdAt'>): Promise<Box> {
        if (links.value.some((l) => l.url === link.url)) {
            throw new Error('URL já cadastrada.');
        }
        const newLink: Box = {
            ...link,
            id: crypto.randomUUID(),
            createdAt: Date.now(),
        };
        await db.links.add(newLink);
        links.value.unshift(newLink);
        return newLink;
    }

    async function removeLink(id: string) {
        await db.links.delete(id);
        await db.images.delete(id);
        links.value = links.value.filter((l) => l.id !== id);
    }

    async function updateLink(id: string, data: Partial<Omit<Box, 'id' | 'createdAt'>>) {
        await db.links.update(id, data);
        const link = links.value.find((l) => l.id === id);
        if (link) Object.assign(link, data);
        if ('image' in data && data.image === '') {
            await db.images.delete(id);
        }
    }

    async function exportLinks(): Promise<Blob> {
        const zip = new JSZip();
        zip.file('links.json', JSON.stringify(links.value, null, 2));

        const linkIds = new Set(links.value.map((l) => l.id));
        const imagesFolder = zip.folder('images')!;
        const storedImages = await db.images.toArray();
        for (const { linkId, blob } of storedImages) {
            if (!linkIds.has(linkId)) continue;
            const ext = MIME_TO_EXT[blob.type] ?? 'bin';
            imagesFolder.file(`${linkId}.${ext}`, blob);
        }

        return await zip.generateAsync({ type: 'blob' });
    }

    async function addNewLinks(parsed: Box[]): Promise<Box[]> {
        const existingIds = new Set(links.value.map((l) => l.id));
        const newLinks = parsed.filter((l) => !existingIds.has(l.id));
        if (newLinks.length) {
            await db.links.bulkAdd(newLinks);
        }
        return newLinks;
    }

    async function importLinks(file: File | Blob) {
        const buf = await file.arrayBuffer();

        if (isZipBuffer(buf)) {
            const zip = await JSZip.loadAsync(buf);
            const jsonFile = zip.file('links.json');
            if (!jsonFile) throw new Error('links.json não encontrado no arquivo');
            const parsed: Box[] = JSON.parse(await jsonFile.async('string'));
            const newLinks = await addNewLinks(parsed);

            // Save images before mutating the reactive list so the watcher
            // in Home picks them up on the same tick.
            for (const link of newLinks) {
                const matches = zip.file(new RegExp(`^images/${link.id}\\.[^.]+$`));
                const entry = matches[0];
                if (!entry) continue;
                const raw = await entry.async('blob');
                const ext = entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase();
                const mime = EXT_TO_MIME[ext];
                const blob = mime ? new Blob([raw], { type: mime }) : raw;
                await db.images.put({ linkId: link.id, blob });
            }

            if (newLinks.length) links.value.unshift(...newLinks);
        } else {
            const text = new TextDecoder().decode(buf);
            const parsed: Box[] = JSON.parse(text);
            const newLinks = await addNewLinks(parsed);
            if (newLinks.length) links.value.unshift(...newLinks);
        }
    }

    async function fetchAndSaveImage(linkId: string, imageUrl: string): Promise<Blob | null> {
        try {
            const res = await fetchViaProxy(imageUrl);
            const blob = await res.blob();
            if (blob.size > MAX_IMAGE_SIZE) return null;
            if (blob.type && !blob.type.startsWith('image/')) return null;

            await db.images.put({ linkId, blob });
            return blob;
        } catch {
            return null;
        }
    }

    async function getImageBlob(linkId: string): Promise<Blob | null> {
        const record = await db.images.get(linkId);
        return record?.blob ?? null;
    }

    async function getStorageSize(): Promise<number> {
        const linksJson = JSON.stringify(links.value);
        let total = new Blob([linksJson]).size;
        await db.images.each((record) => {
            total += record.blob.size;
        });
        return total;
    }

    return {
        links,
        addLink,
        removeLink,
        updateLink,
        exportLinks,
        importLinks,
        fetchAndSaveImage,
        getImageBlob,
        getStorageSize,
    };
}
