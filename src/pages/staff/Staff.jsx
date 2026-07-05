import { useState } from 'react';
import { collection, updateDoc, deleteDoc, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import PageHeader from '../../components/PageHeader';

const ROLES = ['admin', 'manager', 'host', 'server', 'chef', 'kitchen_manager', 'cashier'];

const ROLE_BADGE_COLORS = {
  admin:           'bg-red-100 text-red-700',
  manager:         'bg-purple-100 text-purple-700',
  host:            'bg-blue-100 text-blue-700',
  server:          'bg-amber-100 text-amber-700',
  chef:            'bg-orange-100 text-orange-700',
  kitchen_manager: 'bg-orange-100 text-orange-700',
  cashier:         'bg-green-100 text-green-700',
};

const EMPTY_ADD_FORM = {
  name:   '',
  uid:    '',
  email:  '',
  role:   'server',
  active: true,
};

const EMPTY_EDIT_FORM = {
  name:   '',
  email:  '',
  role:   'server',
  active: true,
};

export default function Staff() {
  const { currentUser } = useAuth();
  const { documents: staffList, loading } = useCollection('staff', 'name', 'asc');

  const [showAddModal, setShowAddModal]   = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingStaff, setEditingStaff]   = useState(null);
  const [addForm, setAddForm]             = useState(EMPTY_ADD_FORM);
  const [editForm, setEditForm]           = useState(EMPTY_EDIT_FORM);
  const [saving, setSaving]               = useState(false);

  // ── open modals ───────────────────────────────────────────────────
  const openAdd = () => {
    setAddForm(EMPTY_ADD_FORM);
    setShowAddModal(true);
  };

  const openEdit = (staff) => {
    setEditingStaff(staff);
    setEditForm({
      name:   staff.name   || '',
      email:  staff.email  || '',
      role:   staff.role   || 'server',
      active: staff.active !== false,
    });
    setShowEditModal(true);
  };

  const closeAdd  = () => { setShowAddModal(false);  setAddForm(EMPTY_ADD_FORM); };
  const closeEdit = () => { setShowEditModal(false); setEditingStaff(null); };

  // ── add staff (setDoc to staff/{uid}) ────────────────────────────
  const handleAdd = async (e) => {
    e.preventDefault();
    if (!addForm.uid.trim()) { toast.error('Firebase Auth UID is required.'); return; }
    if (!addForm.name.trim()) { toast.error('Name is required.'); return; }

    setSaving(true);
    try {
      await setDoc(doc(db, 'staff', addForm.uid.trim()), {
        name:      addForm.name.trim(),
        email:     addForm.email.trim(),
        role:      addForm.role,
        active:    addForm.active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      toast.success(`${addForm.name} added to staff.`);
      closeAdd();
    } catch (err) {
      console.error(err);
      toast.error('Failed to add staff member.');
    } finally {
      setSaving(false);
    }
  };

  // ── edit staff ────────────────────────────────────────────────────
  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editForm.name.trim()) { toast.error('Name is required.'); return; }

    setSaving(true);
    try {
      await updateDoc(doc(db, 'staff', editingStaff.id), {
        name:      editForm.name.trim(),
        role:      editForm.role,
        active:    editForm.active,
        updatedAt: serverTimestamp(),
      });
      toast.success(`${editForm.name} updated.`);
      closeEdit();
    } catch (err) {
      console.error(err);
      toast.error('Failed to update staff member.');
    } finally {
      setSaving(false);
    }
  };

  // ── toggle active inline ──────────────────────────────────────────
  const toggleActive = async (staff) => {
    try {
      await updateDoc(doc(db, 'staff', staff.id), {
        active:    !staff.active,
        updatedAt: serverTimestamp(),
      });
      toast.success(`${staff.name} marked ${!staff.active ? 'active' : 'inactive'}.`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to update status.');
    }
  };

  // ── delete ────────────────────────────────────────────────────────
  const handleDelete = async (staff) => {
    if (!window.confirm(`Remove ${staff.name} from staff? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'staff', staff.id));
      toast.success(`${staff.name} removed.`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete staff member.');
    }
  };

  // ── render ────────────────────────────────────────────────────────
  return (
    <div className="p-6">
      <PageHeader title="Staff Management">
        <button
          onClick={openAdd}
          className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition text-sm font-medium"
        >
          + Add Staff
        </button>
      </PageHeader>

      {loading ? (
        <div className="text-gray-500 text-center py-16">Loading staff…</div>
      ) : !staffList || staffList.length === 0 ? (
        <div className="text-gray-400 text-center py-16">No staff members found.</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 uppercase text-xs tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-5 py-3">Email</th>
                <th className="text-left px-5 py-3">Role</th>
                <th className="text-left px-5 py-3">Active</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {staffList.map((staff) => (
                <tr key={staff.id} className="hover:bg-gray-50 transition">
                  <td className="px-5 py-3 font-medium text-gray-800">{staff.name}</td>
                  <td className="px-5 py-3 text-gray-500">{staff.email || '—'}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                        ROLE_BADGE_COLORS[staff.role] || 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {staff.role?.replace('_', ' ') || '—'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => toggleActive(staff)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                        staff.active !== false ? 'bg-amber-500' : 'bg-gray-300'
                      }`}
                      aria-label="Toggle active"
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                          staff.active !== false ? 'translate-x-4' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEdit(staff)}
                        className="px-3 py-1 text-xs border rounded-lg text-gray-600 hover:bg-gray-100 transition"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(staff)}
                        className="px-3 py-1 text-xs border border-red-200 rounded-lg text-red-600 hover:bg-red-50 transition"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add Staff Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 pt-6 pb-4 border-b">
              <h2 className="text-lg font-semibold text-gray-800">Add Staff Member</h2>
            </div>

            {/* Instructional note */}
            <div className="mx-6 mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 leading-relaxed">
              <strong>Note:</strong> To add a staff member, first create the user in{' '}
              <span className="font-semibold">Firebase Console → Authentication</span>, then paste
              their UID below.
            </div>

            <form onSubmit={handleAdd} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Firebase Auth UID
                </label>
                <input
                  type="text"
                  value={addForm.uid}
                  onChange={(e) => setAddForm({ ...addForm, uid: e.target.value })}
                  placeholder="Paste UID from Firebase Console"
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email <span className="text-gray-400 font-normal">(informational)</span>
                </label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={addForm.role}
                  onChange={(e) => setAddForm({ ...addForm, role: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setAddForm({ ...addForm, active: !addForm.active })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                    addForm.active ? 'bg-amber-500' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      addForm.active ? 'translate-x-4' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-sm text-gray-700">Active</span>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeAdd}
                  className="flex-1 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition"
                >
                  {saving ? 'Adding…' : 'Add Staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Staff Modal ── */}
      {showEditModal && editingStaff && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-6 pt-6 pb-4 border-b">
              <h2 className="text-lg font-semibold text-gray-800">Edit Staff Member</h2>
            </div>
            <form onSubmit={handleEdit} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={editForm.email}
                  readOnly
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Email is managed via Firebase Authentication and cannot be changed here.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditForm({ ...editForm, active: !editForm.active })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                    editForm.active ? 'bg-amber-500' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      editForm.active ? 'translate-x-4' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-sm text-gray-700">Active</span>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="flex-1 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition"
                >
                  {saving ? 'Saving…' : 'Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
