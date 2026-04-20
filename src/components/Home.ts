import { defineComponent, ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { Box } from '@/models/Box';
import { useLinksStorage } from '@/composables/linksStorage';
import { useMetadataFetch } from '@/composables/useMetadataFetch';

export default defineComponent({
    setup() {
        const {
            links, addLink, removeLink, updateLink, exportLinks, importLinks,
            fetchAndSaveImage, getImageBlob, getStorageSize,
        } = useLinksStorage();
        const { fetchMetadata, loading: metaLoading, error: metaError } = useMetadataFetch();

        const url = ref('');
        const title = ref('');
        const description = ref('');
        const tags = ref('');
        const image = ref('');
        const search = ref('');
        const fileInput = ref<HTMLInputElement>();
        const localImages = ref<Record<string, string>>({});
        const storageSize = ref('');
        const urlError = ref('');

        // Tag quick-edit state
        const openTagMenu = ref<string | null>(null);
        const selectedTag = ref<{ cardId: string; tag: string } | null>(null);

        // Edit state
        const editingId = ref<string | null>(null);
        const editUrl = ref('');
        const editTitle = ref('');
        const editDescription = ref('');
        const editTags = ref('');
        const editImage = ref('');
        const editUrlError = ref('');

        async function refreshStorageSize() {
            const bytes = await getStorageSize();
            if (bytes < 1024) {
                storageSize.value = `${bytes} B`;
            } else if (bytes < 1024 * 1024) {
                storageSize.value = `${(bytes / 1024).toFixed(1)} KB`;
            } else {
                storageSize.value = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
            }
        }

        watch(links, async (currentLinks) => {
            const toLoad = currentLinks.filter(
                (l) => l.image && !localImages.value[l.id],
            );
            const results = await Promise.all(
                toLoad.map(async (link) => ({
                    id: link.id,
                    blob: await getImageBlob(link.id),
                })),
            );
            for (const { id, blob } of results) {
                if (blob) {
                    localImages.value[id] = URL.createObjectURL(blob);
                }
            }
            refreshStorageSize();
        }, { immediate: true });

        function closeTagInteractions() {
            openTagMenu.value = null;
            selectedTag.value = null;
        }

        onMounted(() => {
            document.addEventListener('click', closeTagInteractions);
        });

        onUnmounted(() => {
            for (const objUrl of Object.values(localImages.value)) {
                URL.revokeObjectURL(objUrl);
            }
            document.removeEventListener('click', closeTagInteractions);
        });

        const filteredLinks = computed(() => {
            const q = search.value.toLowerCase().trim();
            if (!q) return links.value;
            return links.value.filter(
                (l) =>
                    l.title.toLowerCase().includes(q) ||
                    l.url.toLowerCase().includes(q) ||
                    l.description.toLowerCase().includes(q) ||
                    l.tags.some((t) => t.toLowerCase().includes(q)),
            );
        });

        const pageSize = ref(20);
        const currentPage = ref(1);
        const totalPages = computed(() => Math.max(1, Math.ceil(filteredLinks.value.length / pageSize.value)));
        const pagedLinks = computed(() => {
            const start = (currentPage.value - 1) * pageSize.value;
            return filteredLinks.value.slice(start, start + pageSize.value);
        });

        watch(search, () => { currentPage.value = 1; });
        watch(pageSize, () => { currentPage.value = 1; });
        watch(totalPages, (max) => { if (currentPage.value > max) currentPage.value = max; });

        function prevPage() { if (currentPage.value > 1) currentPage.value--; }
        function nextPage() { if (currentPage.value < totalPages.value) currentPage.value++; }

        const allTags = computed<string[]>(() => {
            const set = new Set<string>();
            for (const link of links.value) {
                for (const tag of link.tags) set.add(tag);
            }
            return Array.from(set).sort();
        });

        function availableTagsForCard(cardId: string): string[] {
            const link = links.value.find((l) => l.id === cardId);
            if (!link) return [];
            return allTags.value.filter((t) => !link.tags.includes(t));
        }

        function toggleTagSelection(cardId: string, tag: string) {
            if (selectedTag.value?.cardId === cardId && selectedTag.value?.tag === tag) {
                selectedTag.value = null;
            } else {
                selectedTag.value = { cardId, tag };
                openTagMenu.value = null;
            }
        }

        function toggleTagMenu(cardId: string) {
            openTagMenu.value = openTagMenu.value === cardId ? null : cardId;
            selectedTag.value = null;
        }

        async function addTagToCard(cardId: string, tag: string) {
            const link = links.value.find((l) => l.id === cardId);
            if (!link) return;
            await updateLink(cardId, { tags: [...link.tags, tag] });
            openTagMenu.value = null;
        }

        async function removeTagFromCard(cardId: string, tag: string) {
            const link = links.value.find((l) => l.id === cardId);
            if (!link) return;
            await updateLink(cardId, { tags: link.tags.filter((t) => t !== tag) });
            selectedTag.value = null;
        }

        function tagSuggestionsFor(tagsValue: string): string[] {
            const parts = tagsValue.split(',');
            const committed = parts.slice(0, -1).map((t) => t.trim().toLowerCase()).filter(Boolean);
            const partial = (parts[parts.length - 1] ?? '').trim().toLowerCase();
            return allTags.value
                .filter((t) => {
                    const tl = t.toLowerCase();
                    return !committed.includes(tl) && (partial === '' || tl.includes(partial));
                })
                .slice(0, 10);
        }

        const tagSuggestions = computed(() => tagSuggestionsFor(tags.value));
        const editTagSuggestions = computed(() => tagSuggestionsFor(editTags.value));

        function applyTagSuggestion(target: 'add' | 'edit', tag: string) {
            const tagsRef = target === 'add' ? tags : editTags;
            const parts = tagsRef.value.split(',');
            const committed = parts.slice(0, -1).map((t) => t.trim()).filter(Boolean);
            committed.push(tag);
            tagsRef.value = committed.join(', ') + ', ';
        }

        function startEdit(link: Box) {
            editingId.value = link.id;
            editUrl.value = link.url;
            editTitle.value = link.title;
            editDescription.value = link.description;
            editTags.value = link.tags.join(', ');
            editImage.value = link.image;
            editUrlError.value = '';
        }

        function cancelEdit() {
            editingId.value = null;
        }

        async function saveEdit() {
            const id = editingId.value;
            if (!id) return;

            const newUrl = editUrl.value.trim();
            if (links.value.some((l) => l.url === newUrl && l.id !== id)) {
                editUrlError.value = 'URL já cadastrada.';
                return;
            }

            const newImageUrl = editImage.value.trim();
            const link = links.value.find((l) => l.id === id);
            if (!link) return;
            const imageChanged = newImageUrl !== link.image;

            if (imageChanged && localImages.value[id]) {
                URL.revokeObjectURL(localImages.value[id]);
                delete localImages.value[id];
            }

            await updateLink(id, {
                url: newUrl,
                title: editTitle.value.trim() || newUrl,
                description: editDescription.value.trim(),
                tags: editTags.value.split(',').map((t) => t.trim()).filter(Boolean),
                image: newImageUrl,
            });

            if (imageChanged && newImageUrl) {
                fetchAndSaveImage(id, newImageUrl).then((blob) => {
                    if (blob) localImages.value[id] = URL.createObjectURL(blob);
                    refreshStorageSize();
                });
            }

            editingId.value = null;
        }

        async function onFetchMetadata() {
            if (!url.value.trim()) return;
            const meta = await fetchMetadata(url.value.trim());
            if (meta) {
                if (meta.title && !title.value) title.value = meta.title;
                if (meta.description && !description.value) description.value = meta.description;
                if (meta.image && !image.value) image.value = meta.image;
            }
        }

        async function onSubmit() {
            if (!url.value.trim()) return;
            urlError.value = '';

            const imageUrl = image.value.trim();

            let newLink;
            try {
                newLink = await addLink({
                    url: url.value.trim(),
                    title: title.value.trim() || url.value.trim(),
                    description: description.value.trim(),
                    tags: tags.value
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    image: imageUrl,
                });
            } catch (err) {
                urlError.value = err instanceof Error ? err.message : 'Erro ao adicionar link.';
                return;
            }

            url.value = '';
            title.value = '';
            description.value = '';
            tags.value = '';
            image.value = '';

            if (imageUrl) {
                fetchAndSaveImage(newLink.id, imageUrl).then((blob) => {
                    if (blob) {
                        localImages.value[newLink.id] = URL.createObjectURL(blob);
                    }
                    refreshStorageSize();
                });
            }
        }

        async function onExport() {
            const blob = await exportLinks();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'linkbox-export.zip';
            a.click();
            URL.revokeObjectURL(a.href);
        }

        function onImportClick() {
            fileInput.value?.click();
        }

        async function onImportFile(e: Event) {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                await importLinks(file);
            } catch {
                alert('Arquivo inválido.');
            }
            if (fileInput.value) fileInput.value.value = '';
        }

        async function confirmRemove(id: string) {
            if (confirm('Remover este link?')) {
                if (localImages.value[id]) {
                    URL.revokeObjectURL(localImages.value[id]);
                    delete localImages.value[id];
                }
                await removeLink(id);
            }
        }

        return {
            links,
            filteredLinks,
            pagedLinks,
            currentPage,
            totalPages,
            pageSize,
            prevPage,
            nextPage,
            openTagMenu,
            selectedTag,
            availableTagsForCard,
            toggleTagSelection,
            toggleTagMenu,
            addTagToCard,
            removeTagFromCard,
            metaLoading,
            metaError,
            url,
            urlError,
            title,
            description,
            tags,
            tagSuggestions,
            image,
            search,
            fileInput,
            localImages,
            storageSize,
            editingId,
            editUrl,
            editUrlError,
            editTitle,
            editDescription,
            editTags,
            editTagSuggestions,
            editImage,
            onFetchMetadata,
            onSubmit,
            onExport,
            onImportClick,
            onImportFile,
            confirmRemove,
            applyTagSuggestion,
            startEdit,
            cancelEdit,
            saveEdit,
        };
    },
});
