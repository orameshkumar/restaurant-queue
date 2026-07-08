import { useState, useEffect } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useDocument } from '../../hooks/useDocument';
import PageHeader from '../../components/PageHeader';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const DEFAULT_SETTINGS = {
  restaurantName: 'My Restaurant',
  address: '',
  phone: '',
  currency: 'INR',
  taxRate: 5,
  taxInclusive: false,
  reservationGracePeriod: 15,
  maxAdvanceBookingDays: 30,
  selfServiceUrl: '',
  upiId: '',
  merchantId: '',
  sectionEwt: { Indoor: 30, Outdoor: 25, 'Bar & Lounge': 20, 'Private Dining': 45 },
  operatingHours: Object.fromEntries(
    DAYS.map((d) => [d, { openTime: '09:00', closeTime: '22:00', closed: false }])
  ),
};

const EWT_SECTIONS = ['Indoor', 'Outdoor', 'Bar & Lounge', 'Private Dining'];

export default function Settings() {
  const { user } = useAuth();
  const { document: settingsDoc, loading } = useDocument('restaurantSettings', 'main');

  const [form, setForm] = useState(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settingsDoc) {
      setForm((prev) => ({
        ...DEFAULT_SETTINGS,
        ...settingsDoc,
        operatingHours: {
          ...DEFAULT_SETTINGS.operatingHours,
          ...(settingsDoc.operatingHours || {}),
        },
      }));
    }
  }, [settingsDoc]);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : type === 'number' ? Number(value) : value,
    }));
  }

  function handleHoursChange(day, field, value) {
    setForm((prev) => ({
      ...prev,
      operatingHours: {
        ...prev.operatingHours,
        [day]: {
          ...prev.operatingHours[day],
          [field]: field === 'closed' ? value : value,
        },
      },
    }));
  }

  function handleLoadDefaults() {
    setForm((prev) => ({
      ...prev,
      restaurantName: DEFAULT_SETTINGS.restaurantName,
      currency: DEFAULT_SETTINGS.currency,
      taxRate: DEFAULT_SETTINGS.taxRate,
      taxInclusive: DEFAULT_SETTINGS.taxInclusive,
      reservationGracePeriod: DEFAULT_SETTINGS.reservationGracePeriod,
      maxAdvanceBookingDays: DEFAULT_SETTINGS.maxAdvanceBookingDays,
    }));
    toast('Defaults loaded. Save to apply.', { icon: '📋' });
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'restaurantSettings', 'main'),
        { ...form, updatedAt: serverTimestamp() },
        { merge: true }
      );
      toast.success('Settings saved successfully!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4">
        <PageHeader title="Restaurant Settings" />
        <div className="flex justify-center items-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <PageHeader title="Restaurant Settings" />
        <button
          type="button"
          onClick={handleLoadDefaults}
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
        >
          Load Defaults
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* General Info */}
        <section className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">General</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Restaurant Name</label>
            <input
              type="text"
              name="restaurantName"
              value={form.restaurantName}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="My Restaurant"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <textarea
              name="address"
              value={form.address}
              onChange={handleChange}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              name="phone"
              value={form.phone}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Self-Service URL</label>
            <input
              type="url"
              name="selfServiceUrl"
              value={form.selfServiceUrl}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="https://..."
            />
          </div>
        </section>

        {/* Financial */}
        <section className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Financial</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <select
                name="currency"
                value={form.currency}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
              >
                <option value="INR">INR – Indian Rupee</option>
                <option value="USD">USD – US Dollar</option>
                <option value="EUR">EUR – Euro</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate (%)</label>
              <input
                type="number"
                name="taxRate"
                value={form.taxRate}
                onChange={handleChange}
                min={0}
                max={100}
                step={0.5}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  name="taxInclusive"
                  checked={form.taxInclusive}
                  onChange={handleChange}
                  className="w-4 h-4 accent-indigo-600"
                />
                Tax Inclusive
              </label>
            </div>
          </div>
        </section>

        {/* Payment */}
        <section className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Payment / UPI</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">UPI ID (VPA)</label>
              <input
                type="text"
                name="upiId"
                value={form.upiId}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="merchant@upi"
              />
              <p className="text-xs text-gray-400 mt-1">e.g. restaurantname@okaxis</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Merchant ID</label>
              <input
                type="text"
                name="merchantId"
                value={form.merchantId}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="MID123456"
              />
              <p className="text-xs text-gray-400 mt-1">Payment gateway merchant ID (shown on receipts).</p>
            </div>
          </div>
          <p className="text-xs text-gray-400">UPI ID is used to generate QR codes at the cashier billing screen.</p>
        </section>

        {/* Reservations */}
        <section className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Reservations</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Grace Period (minutes)</label>
              <input
                type="number"
                name="reservationGracePeriod"
                value={form.reservationGracePeriod}
                onChange={handleChange}
                min={0}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Advance Booking (days)</label>
              <input
                type="number"
                name="maxAdvanceBookingDays"
                value={form.maxAdvanceBookingDays}
                onChange={handleChange}
                min={1}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
        </section>

        {/* Queue / EWT */}
        <section className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Queue / EWT</h2>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">Expected Wait Time per Section (minutes)</p>
            <p className="text-xs text-gray-400 mb-3">Used to calculate estimated wait time for queued customers based on live table availability.</p>
            <div className="space-y-3">
              {EWT_SECTIONS.map((section) => (
                <div key={section} className="flex items-center justify-between gap-4">
                  <label className="text-sm text-gray-700 w-40">{section}</label>
                  <input
                    type="number"
                    min={5}
                    max={180}
                    step={5}
                    value={form.sectionEwt?.[section] ?? 30}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        sectionEwt: { ...prev.sectionEwt, [section]: Number(e.target.value) },
                      }))
                    }
                    className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Operating Hours */}
        <section className="bg-white rounded-xl shadow-sm p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Operating Hours</h2>
          <div className="space-y-2">
            {DAYS.map((day) => {
              const hours = form.operatingHours?.[day] || { openTime: '09:00', closeTime: '22:00', closed: false };
              return (
                <div key={day} className="flex flex-wrap items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className="w-24 text-sm font-medium text-gray-700">{day}</span>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hours.closed || false}
                      onChange={(e) => handleHoursChange(day, 'closed', e.target.checked)}
                      className="accent-red-500"
                    />
                    Closed
                  </label>
                  {!hours.closed && (
                    <>
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs text-gray-400">Open</label>
                        <input
                          type="time"
                          value={hours.openTime || '09:00'}
                          onChange={(e) => handleHoursChange(day, 'openTime', e.target.value)}
                          className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs text-gray-400">Close</label>
                        <input
                          type="time"
                          value={hours.closeTime || '22:00'}
                          onChange={(e) => handleHoursChange(day, 'closeTime', e.target.value)}
                          className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        />
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex justify-end pb-6">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
