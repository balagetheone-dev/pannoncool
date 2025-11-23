CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL, -- 'admin', 'technician', 'office'
  pin TEXT,
  profile_image TEXT,
  deleted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'private', 'company'
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  address TEXT NOT NULL,
  gps_lat REAL,
  gps_lon REAL,
  contact_name TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id)
) STRICT;

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  serial_number TEXT,
  manufacturer TEXT,
  install_date TEXT,
  last_service_date TEXT,
  maintenance_required INTEGER DEFAULT 0, -- boolean 0/1
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (location_id) REFERENCES locations(id)
) STRICT;

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  price REAL NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  work_order_number TEXT NOT NULL,
  work_number TEXT,
  client_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  asset_id TEXT,
  status TEXT NOT NULL, -- 'new', 'in_progress', 'pending', 'completed', 'billed'
  work_type TEXT,
  description TEXT,
  priority TEXT NOT NULL, -- 'normal', 'urgent'
  created_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT,
  failure_date TEXT,
  signature_url TEXT,
  signature_gps_lat REAL,
  signature_gps_lon REAL,
  signature_gps_accuracy REAL,
  travel_distance REAL,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (location_id) REFERENCES locations(id),
  FOREIGN KEY (asset_id) REFERENCES assets(id)
) STRICT;

CREATE TABLE IF NOT EXISTS work_order_technicians (
  work_order_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (work_order_id, user_id),
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) STRICT;

CREATE TABLE IF NOT EXISTS work_order_items (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id),
  FOREIGN KEY (material_id) REFERENCES materials(id)
) STRICT;

CREATE TABLE IF NOT EXISTS work_order_tasks (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL,
  description TEXT NOT NULL,
  completed INTEGER DEFAULT 0,
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id)
) STRICT;

CREATE TABLE IF NOT EXISTS work_order_photos (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL,
  url TEXT NOT NULL,
  timestamp TEXT,
  gps_lat REAL,
  gps_lon REAL,
  type TEXT, -- 'work_photo', 'quote_request'
  quote_request_description TEXT, -- if type is quote_request
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id)
) STRICT;

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  license_plate TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  assigned_user_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (assigned_user_id) REFERENCES users(id)
) STRICT;

CREATE TABLE IF NOT EXISTS vehicle_inventory (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (material_id) REFERENCES materials(id),
  UNIQUE(vehicle_id, material_id)
) STRICT;
