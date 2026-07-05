import { useState } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import PageHeader from '../../components/PageHeader';

const CATEGORIES = ['Starters', 'Mains', 'Desserts', 'Beverages', 'Combos', 'Specials'];
const STATIONS = ['Main Kitchen', 'Grill', 'Cold Kitchen', 'Pastry', 'Bar'];

const DEFAULT_MENU_ITEMS = [
  // Starters
  {
    name: 'Veg Spring Rolls',
    category: 'Starters',
    price: 180,
    prepTime: 15,
    dietaryType: 'veg',
    station: 'Cold Kitchen',
    description: 'Crispy fried rolls stuffed with fresh vegetables and glass noodles.',
    available: true,
  },
  {
    name: 'Chicken Wings',
    category: 'Starters',
    price: 320,
    prepTime: 20,
    dietaryType: 'non-veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Paneer Tikka',
    category: 'Starters',
    price: 260,
    prepTime: 25,
    dietaryType: 'veg',
    station: 'Grill',
    description: '',
    available: true,
  },
  {
    name: 'Fish & Chips',
    category: 'Starters',
    price: 380,
    prepTime: 20,
    dietaryType: 'non-veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Garlic Bread',
    category: 'Starters',
    price: 120,
    prepTime: 10,
    dietaryType: 'veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  // Mains
  {
    name: 'Butter Chicken',
    category: 'Mains',
    price: 420,
    prepTime: 30,
    dietaryType: 'non-veg',
    station: 'Grill',
    description: '',
    available: true,
  },
  {
    name: 'Paneer Butter Masala',
    category: 'Mains',
    price: 360,
    prepTime: 30,
    dietaryType: 'veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Grilled Salmon',
    category: 'Mains',
    price: 680,
    prepTime: 25,
    dietaryType: 'non-veg',
    station: 'Grill',
    description: '',
    available: true,
  },
  {
    name: 'Pasta Arrabbiata',
    category: 'Mains',
    price: 320,
    prepTime: 20,
    dietaryType: 'veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Chicken Biryani',
    category: 'Mains',
    price: 460,
    prepTime: 35,
    dietaryType: 'non-veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Dal Makhani',
    category: 'Mains',
    price: 280,
    prepTime: 25,
    dietaryType: 'veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Grilled Chicken Burger',
    category: 'Mains',
    price: 380,
    prepTime: 20,
    dietaryType: 'non-veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Margherita Pizza',
    category: 'Mains',
    price: 420,
    prepTime: 25,
    dietaryType: 'veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Lamb Rogan Josh',
    category: 'Mains',
    price: 520,
    prepTime: 35,
    dietaryType: 'non-veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Veg Fried Rice',
    category: 'Mains',
    price: 260,
    prepTime: 20,
    dietaryType: 'veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  // Desserts
  {
    name: 'Gulab Jamun',
    category: 'Desserts',
    price: 120,
    prepTime: 5,
    dietaryType: 'veg',
    station: 'Pastry',
    description: '',
    available: true,
  },
  {
    name: 'Chocolate Lava Cake',
    category: 'Desserts',
    price: 280,
    prepTime: 15,
    dietaryType: 'veg',
    station: 'Pastry',
    description: '',
    available: true,
  },
  {
    name: 'Ice Cream (2 scoops)',
    category: 'Desserts',
    price: 160,
    prepTime: 5,
    dietaryType: 'veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Rasgulla',
    category: 'Desserts',
    price: 100,
    prepTime: 5,
    dietaryType: 'veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  // Beverages
  {
    name: 'Fresh Lime Soda',
    category: 'Beverages',
    price: 80,
    prepTime: 5,
    dietaryType: 'veg',
    station: 'Bar',
    description: '',
    available: true,
  },
  {
    name: 'Mango Lassi',
    category: 'Beverages',
    price: 120,
    prepTime: 5,
    dietaryType: 'veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Masala Chai',
    category: 'Beverages',
    price: 60,
    prepTime: 5,
    dietaryType: 'veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Cold Coffee',
    category: 'Beverages',
    price: 140,
    prepTime: 5,
    dietaryType: 'veg',
    station: 'Bar',
    description: '',
    available: true,
  },
  {
    name: 'Fresh Juice (Orange/Watermelon/Pineapple)',
    category: 'Beverages',
    price: 140,
    prepTime: 5,
    dietaryType: 'veg',
    station: 'Bar',
    description: '',
    available: true,
  },
  {
    name: 'Mineral Water',
    category: 'Beverages',
    price: 40,
    prepTime: 1,
    dietaryType: 'veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Soft Drinks',
    category: 'Beverages',
    price: 60,
    prepTime: 2,
    dietaryType: 'veg',
    station: 'Bar',
    description: '',
    available: true,
  },
  // Combos
  {
    name: 'Lunch Combo (Main + Bread + Dal + Dessert)',
    category: 'Combos',
    price: 520,
    prepTime: 40,
    dietaryType: 'veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
  {
    name: 'Non-Veg Feast (Starter + Main + Beverage)',
    category: 'Combos',
    price: 780,
    prepTime: 45,
    dietaryType: 'non-veg',
    station: 'Main Kitchen',
    description: '',
    available: true,
  },
];

const EMPTY_FORM = {
  name: '',
  category: 'Starters',
  price: '',
  prepTime: '',
  dietaryType: 'veg',
  station: 'Main Kitchen',
  description: '',
  calories: '',
  available: true,
};

function DietaryBadge({ type }) {
  if (type === 'vegan') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
        🌿 Vegan
      </span>
    );
  }
  if (type === 'non-veg') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        🔴 Non-Veg
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
      🟢 Veg
    </span>
  );
}

function CategoryBadge({ category }) {
  const colors = {
    Starters: 'bg-orange-100 text-orange-700',
    Mains: 'bg-blue-100 text-blue-700',
    Desserts: 'bg-pink-100 text-pink-700',
    Beverages: 'bg-cyan-100 text-cyan-700',
    Combos: 'bg-yellow-100 text-yellow-700',
    Specials: 'bg-violet-100 text-violet-700',
  };
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
        colors[category] ?? 'bg-gray-100 text-gray-700'
      }`}
    >
      {category}
    </span>
  );
}

function StationBadge({ station }) {
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
      {station}
    </span>
  );
}

function AvailableToggle({ available, onChange }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
        available ? 'bg-amber-500' : 'bg-gray-300'
      }`}
      aria-label={available ? 'Mark unavailable' : 'Mark available'}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          available ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export default function Menu() {
  const { user } = useAuth();
  const { documents: items, loading } = useCollection('menuItems', 'name', 'asc');

  const [activeCategory, setActiveCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);

  // ── Filter ──────────────────────────────────────────────────────────────────
  const filtered = (items ?? []).filter((item) => {
    const matchCat = activeCategory === 'All' || item.category === activeCategory;
    const matchSearch = item.name?.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  // ── Load Defaults ───────────────────────────────────────────────────────────
  async function loadDefaults() {
    const confirmed = window.confirm(
      'This will add missing default menu items (skips duplicates). Continue?'
    );
    if (!confirmed) return;

    setLoadingDefaults(true);
    try {
      const existingNames = new Set(
        (items ?? []).map((i) => i.name?.toLowerCase().trim())
      );

      const toAdd = DEFAULT_MENU_ITEMS.filter(
        (d) => !existingNames.has(d.name.toLowerCase().trim())
      );
      const skipped = DEFAULT_MENU_ITEMS.length - toAdd.length;

      if (toAdd.length === 0) {
        toast('All defaults already exist', { icon: 'ℹ️' });
        return;
      }

      const col = collection(db, 'menuItems');
      await Promise.all(
        toAdd.map((item) =>
          addDoc(col, { ...item, createdAt: serverTimestamp() })
        )
      );

      toast.success(
        `Added ${toAdd.length} item${toAdd.length !== 1 ? 's' : ''} · ${skipped} already existed`
      );
    } catch (err) {
      console.error(err);
      toast.error('Failed to load defaults');
    } finally {
      setLoadingDefaults(false);
    }
  }

  // ── Add / Edit ──────────────────────────────────────────────────────────────
  function openAdd() {
    setEditItem(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEdit(item) {
    setEditItem(item);
    setForm({
      name: item.name ?? '',
      category: item.category ?? 'Starters',
      price: item.price ?? '',
      prepTime: item.prepTime ?? '',
      dietaryType: item.dietaryType ?? 'veg',
      station: item.station ?? 'Main Kitchen',
      description: item.description ?? '',
      calories: item.calories ?? '',
      available: item.available ?? true,
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditItem(null);
    setForm(EMPTY_FORM);
  }

  function handleFormChange(e) {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Item name is required');
    if (!form.price || isNaN(Number(form.price))) return toast.error('Valid price is required');
    if (!form.prepTime || isNaN(Number(form.prepTime)))
      return toast.error('Valid prep time is required');

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        price: Number(form.price),
        prepTime: Number(form.prepTime),
        dietaryType: form.dietaryType,
        station: form.station,
        description: form.description.trim(),
        available: form.available,
        ...(form.calories !== '' && !isNaN(Number(form.calories))
          ? { calories: Number(form.calories) }
          : {}),
      };

      if (editItem) {
        await updateDoc(doc(db, 'menuItems', editItem.id), payload);
        toast.success('Menu item updated');
      } else {
        await addDoc(collection(db, 'menuItems'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        toast.success('Menu item added');
      }
      closeModal();
    } catch (err) {
      console.error(err);
      toast.error('Failed to save item');
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'menuItems', item.id));
      toast.success('Item deleted');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete item');
    }
  }

  // ── Available toggle ────────────────────────────────────────────────────────
  async function toggleAvailable(item) {
    try {
      await updateDoc(doc(db, 'menuItems', item.id), { available: !item.available });
    } catch (err) {
      console.error(err);
      toast.error('Failed to update availability');
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const categoryTabs = ['All', ...CATEGORIES];

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title="Menu Management"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={loadDefaults}
              disabled={loadingDefaults}
              className="px-4 py-2 rounded-lg border border-amber-500 text-amber-600 text-sm font-medium hover:bg-amber-50 transition-colors disabled:opacity-50"
            >
              {loadingDefaults ? 'Loading…' : 'Load Defaults'}
            </button>
            <button
              onClick={openAdd}
              className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors"
            >
              + Add Item
            </button>
          </div>
        }
      />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        {/* Category tabs + search */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Tabs */}
          <div className="flex flex-wrap gap-1">
            {categoryTabs.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  activeCategory === cat
                    ? 'bg-amber-500 text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-amber-400 hover:text-amber-600'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="sm:ml-auto">
            <input
              type="text"
              placeholder="Search items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-56 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
        </div>

        {/* Items grid */}
        {loading ? (
          <div className="text-center py-20 text-gray-400">Loading menu…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            No items found.{' '}
            <button onClick={loadDefaults} className="text-amber-500 underline">
              Load defaults
            </button>{' '}
            or{' '}
            <button onClick={openAdd} className="text-amber-500 underline">
              add an item
            </button>
            .
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((item) => (
              <div
                key={item.id}
                className={`bg-white rounded-xl border shadow-sm p-4 flex flex-col gap-3 transition-opacity ${
                  !item.available ? 'opacity-60' : ''
                }`}
              >
                {/* Top row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 text-sm leading-snug truncate">
                      {item.name}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <CategoryBadge category={item.category} />
                      <DietaryBadge type={item.dietaryType} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-amber-600 font-bold text-sm">₹{item.price}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{item.prepTime} min</p>
                  </div>
                </div>

                {/* Station */}
                <div>
                  <StationBadge station={item.station} />
                </div>

                {/* Description */}
                {item.description ? (
                  <p className="text-xs text-gray-500 line-clamp-2">{item.description}</p>
                ) : null}

                {/* Footer */}
                <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-100">
                  {/* Available toggle */}
                  <div className="flex items-center gap-2">
                    <AvailableToggle
                      available={item.available}
                      onChange={() => toggleAvailable(item)}
                    />
                    <span className="text-xs text-gray-500">
                      {item.available ? 'Available' : '86\'d'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(item)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                      title="Edit"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-800">
                {editItem ? 'Edit Menu Item' : 'Add Menu Item'}
              </h2>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Item Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleFormChange}
                  required
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="e.g. Butter Chicken"
                />
              </div>

              {/* Category + Dietary */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    name="category"
                    value={form.category}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Dietary Type
                  </label>
                  <select
                    name="dietaryType"
                    value={form.dietaryType}
                    onChange={handleFormChange}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value="veg">Veg</option>
                    <option value="non-veg">Non-Veg</option>
                    <option value="vegan">Vegan</option>
                  </select>
                </div>
              </div>

              {/* Price + Prep Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Price (₹) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    name="price"
                    value={form.price}
                    onChange={handleFormChange}
                    required
                    min="0"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="e.g. 320"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Prep Time (min) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    name="prepTime"
                    value={form.prepTime}
                    onChange={handleFormChange}
                    required
                    min="1"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="e.g. 25"
                  />
                </div>
              </div>

              {/* Station */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Station</label>
                <select
                  name="station"
                  value={form.station}
                  onChange={handleFormChange}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  {STATIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleFormChange}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                  placeholder="Short description (optional)"
                />
              </div>

              {/* Calories */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Calories <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="number"
                  name="calories"
                  value={form.calories}
                  onChange={handleFormChange}
                  min="0"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="e.g. 450"
                />
              </div>

              {/* Available */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="available"
                  name="available"
                  checked={form.available}
                  onChange={handleFormChange}
                  className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                />
                <label htmlFor="available" className="text-sm text-gray-700 cursor-pointer">
                  Available on menu
                </label>
              </div>

              {/* Footer buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving…' : editItem ? 'Update Item' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
