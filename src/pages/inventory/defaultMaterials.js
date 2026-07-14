// Standard restaurant raw materials seed data
// Used by the "Load Defaults" feature in InvMaterials

export const DEFAULT_MATERIALS = [
  // ── Grains & Flours ─────────────────────────────────────────────
  { name: 'Rice (Basmati)',        category: 'Grains & Flours', uom: 'Kg',  currentStock: 25, reorderLevel: 10, reorderQty: 25 },
  { name: 'Rice (Regular)',        category: 'Grains & Flours', uom: 'Kg',  currentStock: 30, reorderLevel: 15, reorderQty: 30 },
  { name: 'Wheat Flour (Maida)',   category: 'Grains & Flours', uom: 'Kg',  currentStock: 20, reorderLevel: 8,  reorderQty: 20 },
  { name: 'Wheat Flour (Atta)',    category: 'Grains & Flours', uom: 'Kg',  currentStock: 20, reorderLevel: 8,  reorderQty: 20 },
  { name: 'Semolina (Rava)',       category: 'Grains & Flours', uom: 'Kg',  currentStock: 10, reorderLevel: 4,  reorderQty: 10 },
  { name: 'Chickpea Flour (Besan)',category: 'Grains & Flours', uom: 'Kg',  currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Poha (Flattened Rice)', category: 'Grains & Flours', uom: 'Kg',  currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },

  // ── Pulses & Lentils ────────────────────────────────────────────
  { name: 'Toor Dal',              category: 'Pulses & Lentils', uom: 'Kg', currentStock: 10, reorderLevel: 4,  reorderQty: 10 },
  { name: 'Chana Dal',             category: 'Pulses & Lentils', uom: 'Kg', currentStock: 8,  reorderLevel: 3,  reorderQty: 8  },
  { name: 'Moong Dal',             category: 'Pulses & Lentils', uom: 'Kg', currentStock: 8,  reorderLevel: 3,  reorderQty: 8  },
  { name: 'Urad Dal',              category: 'Pulses & Lentils', uom: 'Kg', currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Rajma (Kidney Beans)',  category: 'Pulses & Lentils', uom: 'Kg', currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Kabuli Chana',          category: 'Pulses & Lentils', uom: 'Kg', currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },

  // ── Oils & Fats ─────────────────────────────────────────────────
  { name: 'Sunflower Oil',         category: 'Oils & Fats', uom: 'Ltr',    currentStock: 20, reorderLevel: 8,  reorderQty: 20 },
  { name: 'Refined Oil',           category: 'Oils & Fats', uom: 'Ltr',    currentStock: 15, reorderLevel: 5,  reorderQty: 15 },
  { name: 'Ghee',                  category: 'Oils & Fats', uom: 'Kg',     currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Butter',                category: 'Oils & Fats', uom: 'Kg',     currentStock: 3,  reorderLevel: 1,  reorderQty: 3  },
  { name: 'Coconut Oil',           category: 'Oils & Fats', uom: 'Ltr',    currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },

  // ── Vegetables ──────────────────────────────────────────────────
  { name: 'Onion',                 category: 'Vegetables', uom: 'Kg',      currentStock: 20, reorderLevel: 8,  reorderQty: 20 },
  { name: 'Tomato',                category: 'Vegetables', uom: 'Kg',      currentStock: 15, reorderLevel: 6,  reorderQty: 15 },
  { name: 'Potato',                category: 'Vegetables', uom: 'Kg',      currentStock: 15, reorderLevel: 6,  reorderQty: 15 },
  { name: 'Garlic',                category: 'Vegetables', uom: 'Kg',      currentStock: 3,  reorderLevel: 1,  reorderQty: 3  },
  { name: 'Ginger',                category: 'Vegetables', uom: 'Kg',      currentStock: 3,  reorderLevel: 1,  reorderQty: 3  },
  { name: 'Green Chilli',          category: 'Vegetables', uom: 'Kg',      currentStock: 2,  reorderLevel: 1,  reorderQty: 2  },
  { name: 'Capsicum',              category: 'Vegetables', uom: 'Kg',      currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Carrot',                category: 'Vegetables', uom: 'Kg',      currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Beans (French)',        category: 'Vegetables', uom: 'Kg',      currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Cauliflower',           category: 'Vegetables', uom: 'Kg',      currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Spinach (Palak)',       category: 'Vegetables', uom: 'Kg',      currentStock: 3,  reorderLevel: 1,  reorderQty: 3  },
  { name: 'Cucumber',              category: 'Vegetables', uom: 'Kg',      currentStock: 3,  reorderLevel: 1,  reorderQty: 3  },
  { name: 'Brinjal',               category: 'Vegetables', uom: 'Kg',      currentStock: 4,  reorderLevel: 2,  reorderQty: 4  },
  { name: 'Peas (Fresh/Frozen)',   category: 'Vegetables', uom: 'Kg',      currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Lemon',                 category: 'Vegetables', uom: 'Kg',      currentStock: 3,  reorderLevel: 1,  reorderQty: 3  },
  { name: 'Curry Leaves',          category: 'Vegetables', uom: 'Kg',      currentStock: 1,  reorderLevel: 0.5,reorderQty: 1  },
  { name: 'Coriander Leaves',      category: 'Vegetables', uom: 'Kg',      currentStock: 1,  reorderLevel: 0.5,reorderQty: 1  },
  { name: 'Mint Leaves',           category: 'Vegetables', uom: 'Kg',      currentStock: 1,  reorderLevel: 0.5,reorderQty: 1  },

  // ── Dairy & Eggs ────────────────────────────────────────────────
  { name: 'Milk',                  category: 'Dairy & Eggs', uom: 'Ltr',   currentStock: 20, reorderLevel: 10, reorderQty: 20 },
  { name: 'Curd (Yogurt)',         category: 'Dairy & Eggs', uom: 'Kg',    currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Paneer',                category: 'Dairy & Eggs', uom: 'Kg',    currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Fresh Cream',           category: 'Dairy & Eggs', uom: 'Ltr',   currentStock: 3,  reorderLevel: 1,  reorderQty: 3  },
  { name: 'Cheese (Processed)',    category: 'Dairy & Eggs', uom: 'Kg',    currentStock: 2,  reorderLevel: 1,  reorderQty: 2  },
  { name: 'Eggs',                  category: 'Dairy & Eggs', uom: 'Nos',   currentStock: 60, reorderLevel: 30, reorderQty: 60 },

  // ── Meat & Seafood ──────────────────────────────────────────────
  { name: 'Chicken (Whole)',       category: 'Meat & Seafood', uom: 'Kg',  currentStock: 10, reorderLevel: 4,  reorderQty: 10 },
  { name: 'Chicken (Boneless)',    category: 'Meat & Seafood', uom: 'Kg',  currentStock: 8,  reorderLevel: 3,  reorderQty: 8  },
  { name: 'Mutton',                category: 'Meat & Seafood', uom: 'Kg',  currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Fish (Fresh)',          category: 'Meat & Seafood', uom: 'Kg',  currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Prawns',                category: 'Meat & Seafood', uom: 'Kg',  currentStock: 3,  reorderLevel: 1,  reorderQty: 3  },

  // ── Spices & Condiments ─────────────────────────────────────────
  { name: 'Salt (Iodized)',        category: 'Spices & Condiments', uom: 'Kg',  currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
  { name: 'Sugar',                 category: 'Spices & Condiments', uom: 'Kg',  currentStock: 10, reorderLevel: 4,  reorderQty: 10 },
  { name: 'Red Chilli Powder',     category: 'Spices & Condiments', uom: 'Kg',  currentStock: 2,  reorderLevel: 0.5,reorderQty: 2  },
  { name: 'Turmeric Powder',       category: 'Spices & Condiments', uom: 'Kg',  currentStock: 1,  reorderLevel: 0.3,reorderQty: 1  },
  { name: 'Coriander Powder',      category: 'Spices & Condiments', uom: 'Kg',  currentStock: 2,  reorderLevel: 0.5,reorderQty: 2  },
  { name: 'Cumin (Jeera)',         category: 'Spices & Condiments', uom: 'Kg',  currentStock: 1,  reorderLevel: 0.3,reorderQty: 1  },
  { name: 'Mustard Seeds',         category: 'Spices & Condiments', uom: 'Kg',  currentStock: 1,  reorderLevel: 0.3,reorderQty: 1  },
  { name: 'Garam Masala',          category: 'Spices & Condiments', uom: 'Kg',  currentStock: 0.5,reorderLevel: 0.2,reorderQty: 0.5},
  { name: 'Biryani Masala',        category: 'Spices & Condiments', uom: 'Kg',  currentStock: 0.5,reorderLevel: 0.2,reorderQty: 0.5},
  { name: 'Pepper (Black)',        category: 'Spices & Condiments', uom: 'Kg',  currentStock: 0.5,reorderLevel: 0.2,reorderQty: 0.5},
  { name: 'Cardamom',              category: 'Spices & Condiments', uom: 'Kg',  currentStock: 0.3,reorderLevel: 0.1,reorderQty: 0.3},
  { name: 'Cloves',                category: 'Spices & Condiments', uom: 'Kg',  currentStock: 0.2,reorderLevel: 0.1,reorderQty: 0.2},
  { name: 'Cinnamon',              category: 'Spices & Condiments', uom: 'Kg',  currentStock: 0.2,reorderLevel: 0.1,reorderQty: 0.2},
  { name: 'Bay Leaves',            category: 'Spices & Condiments', uom: 'Kg',  currentStock: 0.2,reorderLevel: 0.1,reorderQty: 0.2},
  { name: 'Kasuri Methi',          category: 'Spices & Condiments', uom: 'Kg',  currentStock: 0.3,reorderLevel: 0.1,reorderQty: 0.3},
  { name: 'Tamarind',              category: 'Spices & Condiments', uom: 'Kg',  currentStock: 1,  reorderLevel: 0.3,reorderQty: 1  },
  { name: 'Vinegar',               category: 'Spices & Condiments', uom: 'Ltr', currentStock: 2,  reorderLevel: 1,  reorderQty: 2  },
  { name: 'Soy Sauce',             category: 'Spices & Condiments', uom: 'Ltr', currentStock: 1,  reorderLevel: 0.5,reorderQty: 1  },
  { name: 'Tomato Ketchup',        category: 'Spices & Condiments', uom: 'Kg',  currentStock: 3,  reorderLevel: 1,  reorderQty: 3  },
  { name: 'Green Chutney',         category: 'Spices & Condiments', uom: 'Kg',  currentStock: 2,  reorderLevel: 1,  reorderQty: 2  },

  // ── Beverages & Dry Goods ───────────────────────────────────────
  { name: 'Tea (CTC)',             category: 'Beverages', uom: 'Kg',       currentStock: 3,  reorderLevel: 1,  reorderQty: 3  },
  { name: 'Coffee Powder',         category: 'Beverages', uom: 'Kg',       currentStock: 2,  reorderLevel: 0.5,reorderQty: 2  },
  { name: 'Mineral Water Bottles', category: 'Beverages', uom: 'Nos',      currentStock: 100,reorderLevel: 50, reorderQty: 100},
  { name: 'Cold Drink Cans/Bottles',category:'Beverages', uom: 'Nos',      currentStock: 50, reorderLevel: 24, reorderQty: 48 },

  // ── Packaging & Disposables ─────────────────────────────────────
  { name: 'Takeaway Boxes (Small)',category: 'Packaging', uom: 'Nos',      currentStock: 200,reorderLevel: 100,reorderQty: 200},
  { name: 'Takeaway Boxes (Large)',category: 'Packaging', uom: 'Nos',      currentStock: 200,reorderLevel: 100,reorderQty: 200},
  { name: 'Paper Bags',            category: 'Packaging', uom: 'Nos',      currentStock: 200,reorderLevel: 100,reorderQty: 200},
  { name: 'Plastic Spoons',        category: 'Packaging', uom: 'Nos',      currentStock: 500,reorderLevel: 200,reorderQty: 500},
  { name: 'Tissue Paper (Rolls)',  category: 'Packaging', uom: 'Nos',      currentStock: 20, reorderLevel: 10, reorderQty: 20 },
  { name: 'Aluminium Foil',        category: 'Packaging', uom: 'Nos',      currentStock: 5,  reorderLevel: 2,  reorderQty: 5  },
]
