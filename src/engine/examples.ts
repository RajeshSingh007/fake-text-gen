/**
 * Curated, production-shaped sample schemas for the landing page + app.
 *
 * Each one is chosen to *show off* the engine on a real domain:
 *  - saas         → a clean FK chain + money + status enums
 *  - marketplace  → FK fan-out (one table referenced by several) + SKUs + ratings
 *  - chess        → a self-referential FK, two FKs into the same table, and a
 *                   deep child table (the "handful of rows → 1M export" story)
 *
 * The home page renders `EXAMPLES` as clickable cards; each links to
 * `/app?example=<id>`, and the workbench preloads the matching `sql` on mount.
 * SQL is MySQL-dialect (AUTO_INCREMENT + inline ENUM), which the parser tries first.
 */
export interface ExampleSchema {
  id: string;
  /** Card title. */
  name: string;
  /** Short domain tag shown above the title. */
  domain: string;
  /** One-sentence pitch. */
  tagline: string;
  /** Table names, shown as a little FK chain on the card. */
  tables: string[];
  /** The engine feature this schema shows off — the "impressive" bit. */
  highlight: string;
  /** Ready-to-parse DDL. */
  sql: string;
}

export const EXAMPLES: ExampleSchema[] = [
  {
    id: 'saas',
    name: 'Subscription billing',
    domain: 'Fintech · SaaS',
    tagline:
      'Customers, subscriptions and invoices — with realistic plans, MRR, currencies and payment status.',
    tables: ['customers', 'subscriptions', 'invoices'],
    highlight: 'Chained foreign keys · money · status enums',
    sql: `-- SaaS subscription billing
CREATE TABLE customers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  company VARCHAR(120),
  country VARCHAR(60),
  created_at TIMESTAMP
);

CREATE TABLE subscriptions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  plan ENUM('free','starter','pro','enterprise') DEFAULT 'free',
  status ENUM('trialing','active','past_due','canceled') DEFAULT 'trialing',
  seats INT DEFAULT 1,
  mrr DECIMAL(10,2),
  started_at TIMESTAMP,
  renews_at TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE invoices (
  id INT PRIMARY KEY AUTO_INCREMENT,
  subscription_id INT NOT NULL,
  amount_due DECIMAL(10,2),
  currency ENUM('USD','EUR','GBP','INR'),
  status ENUM('draft','open','paid','void','uncollectible') DEFAULT 'open',
  issued_at TIMESTAMP,
  paid_at TIMESTAMP,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);`,
  },
  {
    id: 'marketplace',
    name: 'Online marketplace',
    domain: 'E-commerce',
    tagline:
      'Sellers, products, orders and reviews that stay referentially valid across every join.',
    tables: ['sellers', 'products', 'orders', 'reviews'],
    highlight: 'FK fan-out · SKUs · categories · ratings',
    sql: `-- Online marketplace
CREATE TABLE sellers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  store_name VARCHAR(120) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  country VARCHAR(60),
  rating DECIMAL(3,2),
  is_verified BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMP
);

CREATE TABLE products (
  id INT PRIMARY KEY AUTO_INCREMENT,
  seller_id INT NOT NULL,
  product_name VARCHAR(140) NOT NULL,
  sku VARCHAR(40) UNIQUE,
  category ENUM('electronics','fashion','home','books','toys','beauty'),
  price DECIMAL(10,2),
  in_stock INT DEFAULT 0,
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);

CREATE TABLE orders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  product_id INT NOT NULL,
  buyer_email VARCHAR(255),
  quantity INT DEFAULT 1,
  total DECIMAL(10,2),
  status ENUM('cart','placed','shipped','delivered','returned') DEFAULT 'placed',
  ordered_at TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE reviews (
  id INT PRIMARY KEY AUTO_INCREMENT,
  product_id INT NOT NULL,
  rating INT,
  body TEXT,
  created_at TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
);`,
  },
  {
    id: 'chess',
    name: 'Online chess',
    domain: 'Gaming',
    tagline:
      'Players, tournaments, games and moves — a deep graph with self-referential coaches.',
    tables: ['players', 'tournaments', 'games', 'moves'],
    highlight: 'Self-referential FK · dual player refs · deep child table',
    sql: `-- Online chess platform
CREATE TABLE players (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(40) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(120),
  country VARCHAR(60),
  title ENUM('GM','IM','FM','CM','NM','none') DEFAULT 'none',
  rating INT DEFAULT 1200,
  coach_id INT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP,
  FOREIGN KEY (coach_id) REFERENCES players(id)
);

CREATE TABLE tournaments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  format ENUM('swiss','round_robin','knockout','arena'),
  time_control ENUM('bullet','blitz','rapid','classical'),
  prize_pool DECIMAL(10,2),
  starts_at TIMESTAMP,
  is_active BOOLEAN
);

CREATE TABLE games (
  id INT PRIMARY KEY AUTO_INCREMENT,
  tournament_id INT,
  white_player_id INT NOT NULL,
  black_player_id INT NOT NULL,
  result ENUM('white','black','draw','ongoing') DEFAULT 'ongoing',
  time_control ENUM('bullet','blitz','rapid','classical'),
  opening VARCHAR(80),
  total_moves INT,
  played_at TIMESTAMP,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id),
  FOREIGN KEY (white_player_id) REFERENCES players(id),
  FOREIGN KEY (black_player_id) REFERENCES players(id)
);

CREATE TABLE moves (
  id INT PRIMARY KEY AUTO_INCREMENT,
  game_id INT NOT NULL,
  ply INT NOT NULL,
  san VARCHAR(10),
  seconds_spent DECIMAL(6,2),
  created_at TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id)
);`,
  },
];

/** Look up an example schema by its id (used by the workbench's ?example= handoff). */
export function findExample(id: string | null | undefined): ExampleSchema | undefined {
  if (!id) return undefined;
  return EXAMPLES.find((e) => e.id === id);
}
