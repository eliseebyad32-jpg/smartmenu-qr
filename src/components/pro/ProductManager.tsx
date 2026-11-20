import React, { useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  FolderPlus,
  ImagePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { isSupabaseConfigured } from '../../services/supabaseClient';
import { uploadAssetToSupabaseStorage } from '../../services/supabaseData';
import { uploadAssetToLocalServer } from '../../services/syncService';
import { Category, MenuItem, Restaurant } from '../../types/menu';
import { readAndOptimizeImageBlob } from '../../utils/imageUpload';
import { CulinaryImage } from '../CulinaryImage';

interface ProductManagerProps {
  restaurant: Restaurant;
  categories: Category[];
  items: MenuItem[];
  onSaveItem: (item: MenuItem, isNew: boolean) => void;
  onDeleteItem: (itemId: string) => void;
  onToggleAvailability: (itemId: string) => void;
  onAddCategory: (category: Category) => void;
}

export const ProductManager: React.FC<ProductManagerProps> = ({
  restaurant,
  categories,
  items,
  onSaveItem,
  onDeleteItem,
  onToggleAvailability,
  onAddCategory,
}) => {
  const { t, pick, formatFC } = useLanguage();
  const { showToast } = useToast();

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MenuItem | null>(null);

  const [showCatForm, setShowCatForm] = useState(false);
  const [catNameFr, setCatNameFr] = useState('');
  const [catNameEn, setCatNameEn] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const scopedCategories = useMemo(
    () =>
      categories
        .filter((c) => !c.restaurantId || c.restaurantId === restaurant.id)
        .sort((a, b) => a.order - b.order),
    [categories, restaurant.id]
  );

  const scopedItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (item.restaurantId !== restaurant.id) return false;
      if (catFilter !== 'all' && item.categoryId !== catFilter) return false;
      if (!q) return true;
      return (
        item.name.fr.toLowerCase().includes(q) ||
        item.name.en.toLowerCase().includes(q)
      );
    });
  }, [items, restaurant.id, catFilter, search]);

  const startCreate = () => {
    setIsCreating(true);
    setEditingItem({
      id: `item-${Date.now().toString(36)}`,
      restaurantId: restaurant.id,
      categoryId: scopedCategories[0]?.id ?? 'smash-burgers',
      name: { fr: '', en: '' },
      description: { fr: '', en: '' },
      ingredients: { fr: '', en: '' },
      priceFC: 25000,
      image: '',
      isAvailable: true,
      isPopular: false,
      isSpecialty: false,
      spiceLevel: 0,
      prepMinutes: 12,
    });
  };

  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingItem) return;
    setUploadingPhoto(true);
    try {
      const optimized = await readAndOptimizeImageBlob(file, 900);
      if (isSupabaseConfigured() && navigator.onLine) {
        try {
          const publicUrl = await uploadAssetToSupabaseStorage(
            restaurant.id,
            'dishes',
            `${editingItem.id}.${optimized.extension}`,
            optimized.blob,
            optimized.contentType
          );
          setEditingItem({ ...editingItem, image: publicUrl });
          showToast(t.toast.uploadSuccess);
          return;
        } catch {
          // Fall through to local PC server or inline dataUrl
        }
      }
      const localUrl = await uploadAssetToLocalServer(
        restaurant.id,
        'dishes',
        `${editingItem.id}.${optimized.extension}`,
        optimized.dataUrl
      );
      setEditingItem({ ...editingItem, image: localUrl ?? optimized.dataUrl });
      showToast(t.toast.uploadLocalFallback);
    } catch {
      showToast(t.toast.validationError, 'error');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSubmitItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    if (
      !editingItem.name.fr.trim() ||
      !editingItem.name.en.trim() ||
      !editingItem.description.fr.trim() ||
      !editingItem.description.en.trim() ||
      editingItem.priceFC <= 0
    ) {
      showToast(t.toast.validationError, 'error');
      return;
    }
    onSaveItem({ ...editingItem, image: editingItem.image.trim() }, isCreating);
    showToast(isCreating ? t.toast.dishAdded : t.toast.dishUpdated);
    setEditingItem(null);
    setIsCreating(false);
  };

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!catNameFr.trim() || !catNameEn.trim()) {
      showToast(t.toast.validationError, 'error');
      return;
    }
    const slug = `${catNameFr}-${Date.now().toString(36)}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    onAddCategory({
      id: slug,
      restaurantId: restaurant.id,
      name: { fr: catNameFr.trim(), en: catNameEn.trim() },
      description: { fr: '', en: '' },
      order: scopedCategories.length + 1,
    });
    setCatNameFr('');
    setCatNameEn('');
    setShowCatForm(false);
    showToast(t.toast.categoryAdded);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    onDeleteItem(pendingDelete.id);
    showToast(t.toast.dishDeleted);
    setPendingDelete(null);
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search
              className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.menu.searchPlaceholder}
              className="w-full min-h-[42px] pl-10 pr-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
            />
          </div>

          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            aria-label={t.pro.category}
            className="min-h-[42px] px-3 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white"
          >
            <option value="all">{t.menu.allCategories}</option>
            {scopedCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {pick(c.name)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowCatForm((p) => !p)}
            className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs sm:text-sm font-medium text-zinc-200 cursor-pointer"
          >
            <FolderPlus className="w-4 h-4 text-orange-400" aria-hidden="true" />
            <span>{t.pro.addCategory}</span>
          </button>

          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-xs sm:text-sm font-semibold text-white cursor-pointer"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>{t.pro.addDish}</span>
          </button>
        </div>
      </div>

      {/* Add Category Form */}
      {showCatForm && (
        <form
          onSubmit={handleCreateCategory}
          className="rounded-xl bg-zinc-900 border border-orange-500/40 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
        >
          <div>
            <label className="block text-xs text-zinc-400 mb-1">{t.pro.catNameFr}</label>
            <input
              type="text"
              required
              value={catNameFr}
              onChange={(e) => setCatNameFr(e.target.value)}
              className="w-full min-h-[40px] px-3 rounded-lg bg-[#141418] border border-zinc-700 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">{t.pro.catNameEn}</label>
            <input
              type="text"
              required
              value={catNameEn}
              onChange={(e) => setCatNameEn(e.target.value)}
              className="w-full min-h-[40px] px-3 rounded-lg bg-[#141418] border border-zinc-700 text-sm text-white"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 min-h-[40px] px-4 rounded-lg bg-red-600 hover:bg-red-500 text-xs sm:text-sm font-semibold text-white cursor-pointer"
            >
              {t.pro.createCategoryBtn}
            </button>
            <button
              type="button"
              onClick={() => setShowCatForm(false)}
              className="min-h-[40px] px-3 rounded-lg bg-zinc-800 text-zinc-300 text-xs cursor-pointer"
            >
              {t.pro.cancel}
            </button>
          </div>
        </form>
      )}

      {/* Full Bilingual Dish Form */}
      {editingItem && (
        <form
          onSubmit={handleSubmitItem}
          className="rounded-2xl bg-zinc-900/95 border border-orange-500/50 p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display text-2xl font-bold text-white">
              {isCreating ? t.pro.addDish : t.pro.editDish}
            </h3>
            <button
              type="button"
              onClick={() => {
                setEditingItem(null);
                setIsCreating(false);
              }}
              aria-label={t.menu.close}
              className="p-2 text-zinc-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">{t.pro.nameFr}</label>
              <input
                type="text"
                required
                value={editingItem.name.fr}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    name: { ...editingItem.name, fr: e.target.value },
                  })
                }
                className="w-full min-h-[42px] px-3 rounded-lg bg-[#141418] border border-zinc-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">{t.pro.nameEn}</label>
              <input
                type="text"
                required
                value={editingItem.name.en}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    name: { ...editingItem.name, en: e.target.value },
                  })
                }
                className="w-full min-h-[42px] px-3 rounded-lg bg-[#141418] border border-zinc-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">{t.pro.descFr}</label>
              <textarea
                rows={2}
                required
                value={editingItem.description.fr}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    description: { ...editingItem.description, fr: e.target.value },
                  })
                }
                className="w-full p-3 rounded-lg bg-[#141418] border border-zinc-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">{t.pro.descEn}</label>
              <textarea
                rows={2}
                required
                value={editingItem.description.en}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    description: { ...editingItem.description, en: e.target.value },
                  })
                }
                className="w-full p-3 rounded-lg bg-[#141418] border border-zinc-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">{t.pro.ingrFr}</label>
              <input
                type="text"
                value={editingItem.ingredients.fr}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    ingredients: { ...editingItem.ingredients, fr: e.target.value },
                  })
                }
                className="w-full min-h-[42px] px-3 rounded-lg bg-[#141418] border border-zinc-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">{t.pro.ingrEn}</label>
              <input
                type="text"
                value={editingItem.ingredients.en}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    ingredients: { ...editingItem.ingredients, en: e.target.value },
                  })
                }
                className="w-full min-h-[42px] px-3 rounded-lg bg-[#141418] border border-zinc-700 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                {t.pro.category}
              </label>
              <select
                value={editingItem.categoryId}
                onChange={(e) => setEditingItem({ ...editingItem, categoryId: e.target.value })}
                className="w-full min-h-[42px] px-3 rounded-lg bg-[#141418] border border-zinc-700 text-sm text-white"
              >
                {scopedCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {pick(cat.name)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  {t.pro.priceFc}
                </label>
                <input
                  type="number"
                  min={500}
                  step={500}
                  required
                  value={editingItem.priceFC}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, priceFC: Number(e.target.value) || 0 })
                  }
                  className="w-full min-h-[42px] px-3 rounded-lg bg-[#141418] border border-zinc-700 text-sm text-white font-mono tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  {t.pro.prepMinutesLabel}
                </label>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={editingItem.prepMinutes ?? 12}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      prepMinutes: Number(e.target.value) || 10,
                    })
                  }
                  className="w-full min-h-[42px] px-3 rounded-lg bg-[#141418] border border-zinc-700 text-sm text-white font-mono tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  {t.pro.spiceLevelLabel}
                </label>
                <select
                  value={editingItem.spiceLevel ?? 0}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      spiceLevel: Number(e.target.value) as 0 | 1 | 2 | 3,
                    })
                  }
                  className="w-full min-h-[42px] px-2 rounded-lg bg-[#141418] border border-zinc-700 text-sm text-white"
                >
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </div>
            </div>
          </div>

          {/* Photo Upload / URL + Live Preview (Neutral placeholder if empty) */}
          <div className="pt-2 border-t border-zinc-800 space-y-3">
            <label className="block text-xs font-medium text-zinc-400">{t.pro.photoLabel}</label>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="w-32 h-24 rounded-xl overflow-hidden bg-zinc-950 border border-zinc-700 shrink-0">
                <CulinaryImage
                  src={editingItem.image}
                  alt={pick(editingItem.name) || t.pro.photoLabel}
                />
              </div>

              <div className="flex-1 space-y-2.5 w-full">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 min-h-[38px] px-3.5 rounded-lg bg-[#141418] hover:bg-zinc-800 border border-zinc-700 text-xs font-medium text-zinc-200 cursor-pointer">
                    <ImagePlus className="w-4 h-4 text-orange-400" aria-hidden="true" />
                    <span>{uploadingPhoto ? t.pro.uploadingAsset : t.pro.uploadPhoto}</span>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingPhoto}
                      onChange={handlePhotoFile}
                      className="sr-only"
                    />
                  </label>

                  {editingItem.image && (
                    <button
                      type="button"
                      onClick={() => setEditingItem({ ...editingItem, image: '' })}
                      className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t.pro.removePhoto}</span>
                    </button>
                  )}
                </div>

                <input
                  type="url"
                  value={editingItem.image.startsWith('data:') ? '' : editingItem.image}
                  onChange={(e) => setEditingItem({ ...editingItem, image: e.target.value })}
                  placeholder={t.pro.photoUrlPlaceholder}
                  className="w-full min-h-[38px] px-3 rounded-lg bg-[#141418] border border-zinc-700 text-xs text-white"
                />

                <p className="text-[11px] text-zinc-400">{t.pro.noPhotoHint}</p>
              </div>
            </div>
          </div>

          {/* Flags & Submit */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-zinc-800">
            <div className="flex flex-wrap items-center gap-5">
              <label className="inline-flex items-center gap-2 text-sm text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingItem.isAvailable}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, isAvailable: e.target.checked })
                  }
                  className="w-4 h-4 accent-orange-500"
                />
                <span>{t.pro.statusAvailable}</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!editingItem.isPopular}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, isPopular: e.target.checked })
                  }
                  className="w-4 h-4 accent-orange-500"
                />
                <span>{t.pro.flagPopular}</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!editingItem.isSpecialty}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, isSpecialty: e.target.checked })
                  }
                  className="w-4 h-4 accent-orange-500"
                />
                <span>{t.pro.flagSpecialty}</span>
              </label>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setEditingItem(null);
                  setIsCreating(false);
                }}
                className="min-h-[42px] px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-medium text-zinc-200 cursor-pointer"
              >
                {t.pro.cancel}
              </button>
              <button
                type="submit"
                className="min-h-[42px] px-5 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-semibold text-white cursor-pointer"
              >
                {t.pro.saveDish}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Items List */}
      <div className="divide-y divide-zinc-800/80 border border-zinc-800/80 rounded-2xl bg-[#111115] px-4 sm:px-5">
        {scopedItems.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-400">{t.menu.noResultsTitle}</p>
        ) : (
          scopedItems.map((item) => {
            const cat = scopedCategories.find((c) => c.id === item.categoryId);
            return (
              <div
                key={item.id}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-16 h-12 rounded-lg overflow-hidden bg-zinc-900 shrink-0">
                    <CulinaryImage src={item.image} alt={pick(item.name)} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{pick(item.name)}</p>
                    <p className="text-xs text-zinc-400 truncate">
                      {cat ? pick(cat.name) : item.categoryId} ·{' '}
                      <span className="font-mono text-orange-400 tabular-nums">
                        {formatFC(item.priceFC)}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onToggleAvailability(item.id)}
                    className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg border text-xs font-medium cursor-pointer ${
                      item.isAvailable
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                        : 'bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/20'
                    }`}
                  >
                    {item.isAvailable ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t.menu.available}</span>
                      </>
                    ) : (
                      <>
                        <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t.menu.unavailable}</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setEditingItem(item);
                    }}
                    aria-label={t.pro.editDish}
                    className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white cursor-pointer"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setPendingDelete(item)}
                    aria-label={t.pro.deleteDish}
                    className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg bg-zinc-900 hover:bg-red-950/60 border border-zinc-800 hover:border-red-700/60 text-zinc-400 hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#141418] border border-zinc-800 p-6 shadow-2xl space-y-4">
            <h3 id="confirm-delete-title" className="font-display text-2xl font-bold text-white">
              {t.pro.confirmDeleteTitle}
            </h3>
            <p className="text-sm text-zinc-300 leading-relaxed">
              {t.pro.confirmDeleteBody}{' '}
              <span className="font-semibold text-white">({pick(pendingDelete.name)})</span>
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="min-h-[42px] px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-medium text-zinc-200 cursor-pointer"
              >
                {t.pro.cancel}
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="min-h-[42px] px-4 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-semibold text-white cursor-pointer"
              >
                {t.pro.confirmDeleteBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
