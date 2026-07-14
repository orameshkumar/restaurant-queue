import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  doc, onSnapshot, collection, query, where, getDoc,
} from 'firebase/firestore';
import { db } from '../../firebase/config';

const ITEM_STATUS = {
  placed:           { label: 'Queued',       icon: '⏳', cls: 'bg-gray-100 text-gray-600' },
  'in-kitchen':     { label: 'Queued',       icon: '⏳', cls: 'bg-gray-100 text-gray-600' },
  'in-preparation': { label: 'Preparing',    icon: '👨‍🍳', cls: 'bg-amber-100 text-amber-700' },
  ready:            { label: 'Ready',        icon: '✅', cls: 'bg-green-100 text-green-700' },
  served:           { label: 'Done',         icon: '✅', cls: 'bg-green-100 text-green-700' },
  cancelled:        { label: 'Cancelled',    icon: '✕',  cls: 'bg-red-100 text-red-500' },
};

function fmt(mins) {
  if (mins <= 0) return 'Any moment now';
  if (mins < 60) return `~${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `~${h} hr` : `~${h} hr ${m} min`;
}

export default function TakeawayQueue() {
  const { orderId } = useParams();

  const [order, setOrder]           = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [allActive, setAllActive]   = useState([]);   // all kitchen items for ETA calc
  const [stdDuration, setStdDuration] = useState(5);  // minutes per item, from settings
  const [loading, setLoading]       = useState(true);
  const [notFound, setNotFound]     = useState(false);

  // Load configurable duration from settings once
  useEffect(() => {
    getDoc(doc(db, 'restaurantSettings', 'main')).then(snap => {
      if (snap.exists()) {
        const d = snap.data().standardItemDuration;
        if (d && d > 0) setStdDuration(d);
      }
    });
  }, []);

  // Live order doc
  useEffect(() => {
    if (!orderId) return;
    return onSnapshot(doc(db, 'orders', orderId), snap => {
      if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
      setOrder({ ...snap.data(), id: snap.id });
      setLoading(false);
    });
  }, [orderId]);

  // Live orderItems for this order
  useEffect(() => {
    if (!orderId) return;
    const q = query(collection(db, 'orderItems'), where('orderId', '==', orderId));
    return onSnapshot(q, snap => {
      setOrderItems(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
  }, [orderId]);

  // Live ALL active kitchen items — for queue depth calculation
  useEffect(() => {
    const q = query(
      collection(db, 'orderItems'),
      where('status', 'in', ['placed', 'in-kitchen', 'in-preparation'])
    );
    return onSnapshot(q, snap => {
      setAllActive(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
  }, []);

  // ETA calculation
  const eta = useMemo(() => {
    if (!orderItems.length) return null;
    const myItems = orderItems.filter(
      i => i.status !== 'cancelled' && i.status !== 'served'
    );
    if (myItems.length === 0) return 0; // all done

    // Earliest firedAt of MY items
    const myEarliestMs = myItems.reduce((min, i) => {
      const ms = i.firedAt?.toMillis?.() ?? Infinity;
      return ms < min ? ms : min;
    }, Infinity);

    // Items from OTHER orders that are ahead in queue (fired before mine)
    const ahead = allActive.filter(i => {
      if (i.orderId === orderId) return false;
      if (i.status === 'ready') return false; // ready items don't block
      const ms = i.firedAt?.toMillis?.() ?? 0;
      return ms < myEarliestMs;
    });

    const queued = ahead.filter(i => i.status === 'placed' || i.status === 'in-kitchen').length;
    const inPrep = ahead.filter(i => i.status === 'in-preparation').length;

    // queued items take full duration, in-prep take half (already started)
    const waitMins = Math.round(queued * stdDuration + inPrep * (stdDuration / 2));

    // Also count my own remaining items
    const myPending = myItems.filter(i => i.status === 'placed' || i.status === 'in-kitchen').length;
    const myPrep    = myItems.filter(i => i.status === 'in-preparation').length;
    const myMins    = Math.round(myPending * stdDuration + myPrep * (stdDuration / 2));

    return waitMins + myMins;
  }, [orderItems, allActive, orderId, stdDuration]);

  // Derived state
  const activeItems = orderItems.filter(i => i.status !== 'cancelled');
  const allReady    = activeItems.length > 0 &&
    activeItems.every(i => i.status === 'ready' || i.status === 'served');
  const isCompleted = order?.status === 'completed';
  const isCancelled = order?.status === 'cancelled';

  const overallStatus = isCompleted
    ? 'completed'
    : isCancelled
    ? 'cancelled'
    : allReady
    ? 'ready'
    : activeItems.some(i => i.status === 'in-preparation')
    ? 'preparing'
    : 'queued';

  const isDelivery  = order?.type === 'delivery';
  const accentCls   = isDelivery ? 'from-purple-600 to-purple-800' : 'from-teal-600 to-teal-800';
  const ringCls     = isDelivery ? 'ring-purple-300' : 'ring-teal-300';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (notFound || !order) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-4xl mb-4">🤷</p>
          <h2 className="text-xl font-bold text-gray-700">Order not found</h2>
          <p className="text-sm text-gray-500 mt-2">This link may be invalid or expired.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top banner */}
      <div className={`bg-gradient-to-r ${accentCls} text-white px-6 py-8 text-center`}>
        <p className="text-sm font-medium opacity-80 mb-1">
          {isDelivery ? '🛵 Delivery Order' : '🥡 Takeaway Order'}
        </p>
        {order.pickupToken ? (
          <>
            <p className="text-xs opacity-70 mb-1">Your Token</p>
            <p className="text-6xl font-black tracking-wide mb-2">{order.pickupToken}</p>
          </>
        ) : (
          <p className="text-2xl font-bold mb-2">#{order.id.slice(-6).toUpperCase()}</p>
        )}
        <p className="text-lg font-semibold opacity-90">{order.customerName}</p>
        <p className="text-sm opacity-70">{order.customerPhone}</p>
        {order.deliveryAddress && (
          <p className="text-xs opacity-60 mt-1 max-w-xs mx-auto">{order.deliveryAddress}</p>
        )}
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 flex flex-col gap-6">
        {/* Status card */}
        {isCompleted ? (
          <div className="bg-green-50 border-2 border-green-400 rounded-2xl p-6 text-center">
            <p className="text-5xl mb-3">🎉</p>
            <h2 className="text-xl font-bold text-green-700">Order Completed!</h2>
            <p className="text-sm text-green-600 mt-2">
              {isDelivery
                ? 'Your order has been handed to the delivery person.'
                : 'Your order has been handed over. Enjoy!'}
            </p>
            <p className="text-xs text-gray-400 mt-4">This queue session is now closed.</p>
          </div>
        ) : isCancelled ? (
          <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-6 text-center">
            <p className="text-4xl mb-3">❌</p>
            <h2 className="text-lg font-bold text-red-700">Order Cancelled</h2>
            <p className="text-sm text-red-500 mt-2">Please contact the counter for assistance.</p>
          </div>
        ) : allReady ? (
          <div className={`border-2 ${isDelivery ? 'border-purple-400 bg-purple-50' : 'border-teal-400 bg-teal-50'} rounded-2xl p-6 text-center`}>
            <p className="text-5xl mb-3">🔔</p>
            <h2 className={`text-xl font-bold ${isDelivery ? 'text-purple-700' : 'text-teal-700'}`}>
              {isDelivery ? 'Ready for Dispatch!' : 'Ready for Pickup!'}
            </h2>
            <p className={`text-sm mt-2 ${isDelivery ? 'text-purple-600' : 'text-teal-600'}`}>
              {isDelivery
                ? 'Your order is packed and ready for the delivery person.'
                : `Please collect your order — Token ${order.pickupToken ?? ''}`}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
            <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full ring-4 ${ringCls} ${isDelivery ? 'bg-purple-100' : 'bg-teal-100'} mb-4`}>
              <span className="text-4xl">
                {overallStatus === 'preparing' ? '👨‍🍳' : '⏳'}
              </span>
            </div>
            <h2 className="text-lg font-bold text-gray-800">
              {overallStatus === 'preparing' ? 'Being Prepared' : 'In Queue'}
            </h2>
            {eta !== null && eta > 0 && (
              <p className={`text-3xl font-black mt-2 ${isDelivery ? 'text-purple-700' : 'text-teal-700'}`}>
                {fmt(eta)}
              </p>
            )}
            {eta === 0 && (
              <p className="text-lg font-bold text-green-600 mt-2">Almost ready!</p>
            )}
            <p className="text-xs text-gray-400 mt-2">
              Estimated wait · refreshes automatically
            </p>
          </div>
        )}

        {/* Item status list */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b bg-gray-50">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Items</p>
          </div>
          <div className="divide-y">
            {orderItems
              .filter(i => i.status !== 'cancelled')
              .map(item => {
                const s = ITEM_STATUS[item.status] ?? ITEM_STATUS['placed'];
                return (
                  <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="text-xl flex-shrink-0">{s.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                      <p className="text-xs text-gray-400">× {item.qty ?? 1}</p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${s.cls}`}>
                      {s.label}
                    </span>
                  </div>
                );
              })}
            {orderItems.filter(i => i.status === 'cancelled').length > 0 && (
              <div className="px-5 py-3">
                {orderItems.filter(i => i.status === 'cancelled').map(item => (
                  <div key={item.id} className="flex items-center gap-3 opacity-40">
                    <span className="text-xl">✕</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-through text-gray-500 truncate">{item.name}</p>
                    </div>
                    <span className="text-xs text-red-400">
                      {item.cancelReason === 'not_available' ? 'Out of stock' : 'Removed'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Info footer */}
        {!isCompleted && !isCancelled && (
          <p className="text-center text-xs text-gray-400 pb-6">
            Keep this page open to track your order status live.
            {isDelivery ? '' : ' Present your token at the counter when collecting.'}
          </p>
        )}
      </div>
    </div>
  );
}
