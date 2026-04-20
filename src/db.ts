import Dexie, { type Table } from 'dexie';
import type { Box } from '@/models/Box';

export interface StoredImage {
    linkId: string;
    blob: Blob;
}

class LinkBoxDB extends Dexie {
    links!: Table<Box, string>;
    images!: Table<StoredImage, string>;

    constructor() {
        super('linkbox');
        this.version(1).stores({
            links: 'id, createdAt',
            images: 'linkId',
        });
    }
}

export const db = new LinkBoxDB();
