import { useState } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import PageHeader from '../../components/PageHeader';

const SECTIONS = ['Indoor', 'Outdoor', 'Bar & Lounge', 'Private Dining'];

const DEFAULT_TABLES = [
  // Indoor
  { tableNumber: 1,  section: 'Indoor',        capacity: 2  },
  { tableNumber: 2,  section: 'Indoor',        capacity: 4  },
  { tableNumber: 3,  section: 'Indoor',        capacity: 4  },
  { tableNumber: 4,  section: 'Indoor',        capacity: 4  },
  { tableNumber: 5,  section: 'Indoor',        capacity: 6  },
  { tableNumber: 6,  section: 'Indoor',        capacity: 6  },
  // Outdoor
  { tableNumber: 7,  section: 'Outdoor',       capacity: 2  },
  { tableNumber: 8,  section: 'Outdoor',       capacity: 4  },
  { tableNumber: 9,  section: 'Outdoor',       capacity: 4  },
  { tableNumber: 10, section: 'Outdoor',       capacity: 6  },
  // Bar/Lounge
  { tableNumber: 11, section: 'Bar & Lounge',  capacity: 2  },
  { tableNumber: 12, section: 'Bar & Lounge',  capacity: 2  },
  { tableNumber: 13, section: 'Bar & Lounge',  capacity: 4  },
  { tableNumber: 14, section: 'Bar & Lounge',  capacity: 4  },
  // Private Dining
  { tableNumber: 15, section: 'Private Dining', capacity: 8  },
  { tableNumber: 16, section: 'Private Dining', capacity: 12 },
];

const STATUS_COLORS = {
  available: 'bg-green-100 text-green-800',
  occupied:  'bg-amber-100 text-amber-800',
  cleaning:  'bg-gray-100 text-gray-700',
  blocked:   'bg-red-100 text-red-800',
};

const EMPTY_FORM = {
  tableNumber: '',
  section: 'Indoor',
  capacity: '',
  notes: '',
};

export default function Tables() {
  const { currentUser } = useAuth();
  const { docs: tables = [], loading } = useCollection('tables', 'tableNumber', 'asc');

  const [sectionFilter, setSectionFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [editingTable, setEditingTable] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // ── section filter tabs ──────────────────────────────────────────
  const sectionTabs = ['All', ...SECTIONS];

  const filtered = (tables || []).filter(
    (t) => sectionFilter === 'All' || t.section === sectionFilter,
  );

  // ── modal helpers ────────────────────────────────────────────────
  const openAdd = () => {
    setEditingTable(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (table) => {
    setEditingTable(table);
    setForm({
      tableNumber: table.tableNumber,
      section:     table.section,
      capacity:    table.capacity,
      notes:       table.notes || '',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTable(null);
    setForm(EMPTY_FORM);
  };

  // ── save ─────────────────────────────────────────────────────────
  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.tableNumber || !form.capacity) {
      toast.error('Table number and capacity are required.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        tableNumber:       Number(form.tableNumber),
        section:           form.section,
        capacity:          Number(form.capacity),
        notes:             form.notes,
        updatedAt:         serverTimestamp(),
      };

      if (editingTable) {
        await updateDoc(doc(db, 'tables', editingTable.id), payload);
        toast.success('Table updated.');
      } else {
        await addDoc(collection(db, 'tables'), {
          ...payload,
          status:            'available',
          assignedServerId:  null,
          currentBookingId:  null,
          createdAt:         serverTimestamp(),
        });
        toast.success('Table added.');
      }
      closeModal();
    } catch (err) {
      console.error(err);
      toast.error('Failed to save table.');
    } finally {
      setSaving(false);
    }
  };

  // ── delete ────────────────────────────────────────────────────────
  const handleDelete = async (table) => {
    if (!window.confirm(`Delete Table ${table.tableNumber}? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'tables', table.id));
      toast.success(`Table ${table.tableNumber} deleted.`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete table.');
    }
  };

  // ── load defaults ────────────────────────────────────────────────
  const loadDefaults = async () => {
    if (
      !window.confirm(
        'Load default tables? Existing tables with the same number will be skipped.',
      )
    )
      return;

    const existingNumbers = new Set((tables || []).map((t) => t.tableNumber));
    const toAdd = DEFAULT_TABLES.filter((t) => !existingNumbers.has(t.tableNumber));

    if (toAdd.length === 0) {
      toast('All default tables already exist.', { icon: 'ℹ️' });
      return;
    }

    try {
      await Promise.all(
        toAdd.map((t) =>
          addDoc(collection(db, 'tables'), {
            ...t,
            status:           'available',
            assignedServerId: null,
            currentBookingId: null,
            notes:            '',
            createdAt:        serverTimestamp(),
            updatedAt:        serverTimestamp(),
          }),
        ),
      );
      toast.success(`${toAdd.length} default table(s) loaded.`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load defaults.');
    }
  };

  // ── render ────────────────────────────────────────────────────────
  return (
    <div className="p-6">
      <PageHeader title="Table Configuration">
        <button
          onClick={loadDefaults}
          className="px-4 py-2 border border-amber-500 text-amber-600 rounded-lg hover:bg-amber-50 transition text-sm font-medium"
        >
          Load Defaults
        </button>
        <button
          onClick={openAdd}
          className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition text-sm font-medium"
        >
          + Add Table
        </button>
      </PageHeader>

      {/* Section filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {sectionTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setSectionFilter(tab)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              sectionFilter === tab
                ? 'bg-amber-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Table cards */}
      {loading ? (
        <div className="text-gray-500 text-center py-16">Loading tables…</div>
      ) : filtered.length === 0 ? (
        <div className="text-gray-400 text-center py-16">No tables found.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {filtered.map((table) => (
            <div
              key={table.id}
              className={`rounded-xl p-4 flex flex-col gap-2 border ${
                STATUS_COLORS[table.status] || 'bg-white'
              } shadow-sm`}
            >
              <div className="text-3xl font-bold text-gray-800 leading-none">
                {table.tableNumber}
              </div>
              <span className="text-xs font-medium px-2 py-0.5 bg-white/60 rounded-full w-fit">
                {table.section}
              </span>
              <div className="text-sm text-gray-600 flex items-center gap-1">
                <span>👥</span>
                <span>{table.capacity}</span>
              </div>
              <span
                className={`text-xs font-semibold capitalize px-2 py-0.5 rounded-full w-fit ${
                  STATUS_COLORS[table.status] || ''
                }`}
              >
                {table.status || 'available'}
              </span>
              {table.notes ? (
                <p className="text-xs text-gray-500 truncate" title={table.notes}>
                  {table.notes}
                </p>
              ) : null}
              <div className="flex gap-1 mt-auto pt-1">
                <button
                  onClick={() => openEdit(table)}
                  className="flex-1 text-xs py-1 rounded bg-white/70 hover:bg-white border border-gray-200 text-gray-700 transition"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(table)}
                  className="flex-1 text-xs py-1 rounded bg-white/70 hover:bg-red-50 border border-gray-200 text-red-600 transition"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 pt-6 pb-4 border-b">
              <h2 className="text-lg font-semibold text-gray-800">
                {editingTable ? `Edit Table ${editingTable.tableNumber}` : 'Add Table'}
              </h2>
            </div>
            <form onSubmit={handleSave} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Table Number
                </label>
                <input
                  type="number"
                  min="1"
                  value={form.tableNumber}
                  onChange={(e) => setForm({ ...form, tableNumber: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
                <select
                  value={form.section}
                  onChange={(e) => setForm({ ...form, section: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  {SECTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
                <input
                  type="number"
                  min="1"
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="e.g. Near window, wheelchair accessible"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition"
                >
                  {saving ? 'Saving…' : editingTable ? 'Update' : 'Add Table'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
