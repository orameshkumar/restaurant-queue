import React, { useState, useEffect } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebase/config";

const EMPTY_FORM = {
  name: "",
  phone: "",
  whatsapp: "",
  email: "",
  address: "",
  notes: "",
};

export default function InvVendors() {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [sameAsPhone, setSameAsPhone] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete confirm modal
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Toast
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "invVendors"), orderBy("name"));
    const unsub = onSnapshot(q, (snap) => {
      setVendors(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  function showToast(msg, type = "info") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── Modal helpers ──────────────────────────────────────────────────────────
  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setSameAsPhone(false);
    setShowModal(true);
  }

  function openEdit(vendor) {
    setEditId(vendor.id);
    setForm({
      name: vendor.name || "",
      phone: vendor.phone || "",
      whatsapp: vendor.whatsapp || "",
      email: vendor.email || "",
      address: vendor.address || "",
      notes: vendor.notes || "",
    });
    setSameAsPhone(false);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditId(null);
    setForm(EMPTY_FORM);
    setSameAsPhone(false);
  }

  function handleFormChange(e) {
    const { name, value } = e.target;
    setForm((prev) => {
      const updated = { ...prev, [name]: value };
      if (name === "phone" && sameAsPhone) {
        updated.whatsapp = value;
      }
      return updated;
    });
  }

  function handleSameAsPhone(e) {
    const checked = e.target.checked;
    setSameAsPhone(checked);
    if (checked) {
      setForm((prev) => ({ ...prev, whatsapp: prev.phone }));
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    const data = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      whatsapp: sameAsPhone ? form.phone.trim() : form.whatsapp.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      notes: form.notes.trim(),
      updatedAt: serverTimestamp(),
    };
    try {
      if (editId) {
        await updateDoc(doc(db, "invVendors", editId), data);
        showToast("Vendor updated.", "success");
      } else {
        await addDoc(collection(db, "invVendors"), {
          ...data,
          createdAt: serverTimestamp(),
        });
        showToast("Vendor added.", "success");
      }
      closeModal();
    } catch (err) {
      showToast("Error saving vendor.", "error");
    } finally {
      setSaving(false);
    }
  }

  // ── WhatsApp opener ────────────────────────────────────────────────────────
  function openWhatsApp(vendor) {
    const raw = vendor.whatsapp || vendor.phone || "";
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      showToast("No WhatsApp number on file.", "error");
      return;
    }
    const msg = encodeURIComponent("Hello, this is a test message.");
    window.open(`https://wa.me/${digits}?text=${msg}`, "_blank");
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, "invVendors", deleteTarget.id));
      showToast("Vendor deleted.", "success");
    } catch {
      showToast("Error deleting vendor.", "error");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = vendors.filter((v) =>
    v.name?.toLowerCase().includes(search.toLowerCase())
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 w-full">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded shadow text-white text-sm ${
            toast.type === "success"
              ? "bg-green-600"
              : toast.type === "error"
              ? "bg-red-600"
              : "bg-gray-700"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold">Vendors</h1>
        <button
          onClick={openAdd}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
        >
          + Add Vendor
        </button>
      </div>

      {/* Search */}
      <div className="flex gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          className="border rounded px-3 py-2 text-sm flex-1"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          {vendors.length === 0 ? (
            <>
              No vendors yet.{" "}
              <button
                onClick={openAdd}
                className="text-blue-600 underline hover:text-blue-800"
              >
                Add your first vendor
              </button>
            </>
          ) : (
            "No vendors match your search."
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="px-3 py-2 border">Name</th>
                <th className="px-3 py-2 border">Phone</th>
                <th className="px-3 py-2 border">Email</th>
                <th className="px-3 py-2 border">Address</th>
                <th className="px-3 py-2 border text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 border font-medium">{v.name}</td>
                  <td className="px-3 py-2 border">{v.phone || "—"}</td>
                  <td className="px-3 py-2 border">{v.email || "—"}</td>
                  <td className="px-3 py-2 border">{v.address || "—"}</td>
                  <td className="px-3 py-2 border text-center">
                    <div className="flex justify-center gap-2">
                      {/* WhatsApp */}
                      <button
                        title="Open WhatsApp"
                        onClick={() => openWhatsApp(v)}
                        className="text-green-600 hover:text-green-800"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="w-5 h-5"
                        >
                          <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.979-1.418A9.956 9.956 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.951 7.951 0 01-4.073-1.117l-.292-.174-3.01.857.871-2.94-.19-.302A7.963 7.963 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8zm4.406-5.845c-.242-.121-1.432-.707-1.654-.787-.222-.08-.384-.121-.545.121-.162.242-.626.787-.768.949-.141.162-.283.182-.525.061-.242-.121-1.022-.377-1.947-1.2-.72-.641-1.206-1.433-1.347-1.675-.141-.242-.015-.373.106-.493.109-.108.242-.283.363-.424.121-.141.162-.242.242-.404.08-.162.04-.303-.02-.424-.061-.121-.545-1.312-.747-1.797-.197-.472-.397-.408-.545-.415l-.464-.008a.89.89 0 00-.646.303c-.222.242-.848.829-.848 2.021 0 1.192.869 2.343.99 2.505.121.162 1.71 2.609 4.144 3.658.58.25 1.032.4 1.385.512.582.185 1.112.159 1.53.097.467-.069 1.432-.585 1.634-1.15.202-.564.202-1.048.141-1.15-.06-.101-.222-.162-.464-.283z" />
                        </svg>
                      </button>
                      {/* Edit */}
                      <button
                        title="Edit"
                        onClick={() => openEdit(v)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="w-5 h-5"
                        >
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      {/* Delete */}
                      <button
                        title="Delete"
                        onClick={() => setDeleteTarget(v)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="w-5 h-5"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-semibold text-lg">
                {editId ? "Edit Vendor" : "Add Vendor"}
              </h2>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSave} className="px-5 py-4 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleFormChange}
                  required
                  className="border rounded w-full px-3 py-2 text-sm"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-sm font-medium mb-1">Phone</label>
                <input
                  name="phone"
                  value={form.phone}
                  onChange={handleFormChange}
                  className="border rounded w-full px-3 py-2 text-sm"
                />
              </div>

              {/* WhatsApp */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium">WhatsApp</label>
                  <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sameAsPhone}
                      onChange={handleSameAsPhone}
                    />
                    Same as phone
                  </label>
                </div>
                <input
                  name="whatsapp"
                  value={sameAsPhone ? form.phone : form.whatsapp}
                  onChange={handleFormChange}
                  disabled={sameAsPhone}
                  className="border rounded w-full px-3 py-2 text-sm disabled:bg-gray-100"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleFormChange}
                  className="border rounded w-full px-3 py-2 text-sm"
                />
              </div>

              {/* Address */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Address
                </label>
                <textarea
                  name="address"
                  value={form.address}
                  onChange={handleFormChange}
                  rows={2}
                  className="border rounded w-full px-3 py-2 text-sm"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleFormChange}
                  rows={2}
                  className="border rounded w-full px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm rounded border hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? "Saving…" : editId ? "Update" : "Add"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
            <h2 className="font-semibold text-lg mb-2">Delete Vendor</h2>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete{" "}
              <span className="font-medium">{deleteTarget.name}</span>? This
              cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm rounded border hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
