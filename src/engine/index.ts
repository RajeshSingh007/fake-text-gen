export * from './types';
export * from './prng';
export * from './typeMap';
export * from './topoSort';
export * from './generate';
export * from './export';
export * from './examples';
export { parseSql, SqlParseError, type ParseResult } from './parsers/sql';

/** A ready-to-run sample schema for the empty state / "Try an example" button. */
export const SAMPLE_SQL = `CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  city VARCHAR(80),
  role ENUM('admin','member','guest') DEFAULT 'member',
  is_active BOOLEAN,
  created_at TIMESTAMP
);

CREATE TABLE orders (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  product_name VARCHAR(120),
  total DECIMAL(10,2),
  status ENUM('pending','paid','shipped','cancelled'),
  created_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);`;
