import { useState } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import PageHeader from '../../components/PageHeader';

// ─── Assign Server Modal ──────────────────────────────────────────────────────

function AssignServerModal({ table, onClose }) {
  const { docs: servers = [] } = useCollection('staff', 'name', 'asc', [['role', '==', 'server']]);
  const [selectedId, setSelectedId] = useState(table.assignedServerId ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      if (selectedId) {
        const server = servers.find((s) => s.id === selectedId);
        await updateDoc(doc(db, 'tables', table.id), {
          assignedServerId: selectedId,
          assignedServerName: server?.name ?? null,
          updatedAt: serverTimestamp(),
        });
        toast.success(`Table ${table.tableNumber} assigned to ${server?.name ?? 'server'}.`);
      } else {
        await updateDoc(doc(db, 'tables', table.id), {
          assignedServerId: null,
          assignedServerName: null,
          updatedAt: serverTimestamp(),
        });
        toast.success(`Server unassigned from Table ${table.tableNumber}.`);
      }
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Failed to assign server.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-800">
            Assign Server — Table {table.tableNumber}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <label htmlFor="assign-server-select" className="block text-sm font-medium text-gray-700">
            Server
          </label>
          <select
            id="assign-server-select"
            name="assignServer"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <option value="">— None (unassign) —</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {servers.length === 0 && (
            <p className="text-xs text-gray-400">No staff with role "server" found.</p>
          )}
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [assignServerTable, setAssignServerTable] = useState(null);

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

  // ── block / unblock ──────────────────────────────────────────────
  const handleToggleBlock = async (table) => {
    const newStatus = table.status === 'blocked' ? 'available' : 'blocked';
    try {
      await updateDoc(doc(db, 'tables', table.id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
      toast.success(`Table ${table.tableNumber} ${newStatus === 'blocked' ? 'blocked' : 'unblocked'}.`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to update table status.');
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
              {table.assignedServerName ? (
                <p className="text-xs text-blue-600 truncate" title={table.assignedServerName}>
                  🧑‍🍳 {table.assignedServerName}
                </p>
              ) : (
                <p className="text-xs text-gray-400">No server</p>
              )}
              <div className="flex gap-1 mt-auto pt-1 flex-wrap">
                <button
                  onClick={() => setAssignServerTable(table)}
                  className="w-full text-xs py-1 rounded bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 transition mb-1"
                >
                  👤 Assign Server
                </button>
                <button
                  onClick={() => handleToggleBlock(table)}
                  disabled={['occupied','ordering','eating','bill_requested','reserved','cleaning'].includes(table.status)}
                  className={`flex-1 text-xs py-1 rounded border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                    table.status === 'blocked'
                      ? 'bg-green-50 hover:bg-green-100 border-green-300 text-green-700'
                      : 'bg-red-50 hover:bg-red-100 border-red-200 text-red-600'
                  }`}
                >
                  {table.status === 'blocked' ? 'Unblock' : 'Block'}
                </button>
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
                  Del
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Assign Server Modal */}
      {assignServerTable && (
        <AssignServerModal
          table={assignServerTable}
          onClose={() => setAssignServerTable(null)}
        />
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
                <label htmlFor="table-number" className="block text-sm font-medium text-gray-700 mb-1">
                  Table Number
                </label>
                <input
                  type="number"
                  id="table-number"
                  name="tableNumber"
                  min="1"
                  value={form.tableNumber}
                  onChange={(e) => setForm({ ...form, tableNumber: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  required
                />
              </div>
              <div>
                <label htmlFor="table-section" className="block text-sm font-medium text-gray-700 mb-1">Section</label>
                <select
                  id="table-section"
                  name="section"
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
                <label htmlFor="table-capacity" className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
                <input
                  type="number"
                  id="table-capacity"
                  name="capacity"
                  min="1"
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  required
                />
              </div>
              <div>
                <label htmlFor="table-notes" className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input
                  type="text"
                  id="table-notes"
                  name="notes"
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
