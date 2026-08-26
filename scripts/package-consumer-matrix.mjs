export const PACKAGE_CONSUMER_MATRIX = Object.freeze([
  Object.freeze({ node: "22.12.0", typescript: "5.7.3" }),
  Object.freeze({ node: "22.12.0", typescript: "6.0.3" }),
  Object.freeze({ node: "24.19.0", typescript: "5.7.3" }),
  Object.freeze({ node: "24.19.0", typescript: "6.0.3" }),
]);

export const PACKAGE_CONSUMER_NODE_VERSIONS = Object.freeze([
  ...new Set(PACKAGE_CONSUMER_MATRIX.map(({ node }) => node)),
]);

export const PACKAGE_CONSUMER_TYPESCRIPT_VERSIONS = Object.freeze([
  ...new Set(PACKAGE_CONSUMER_MATRIX.map(({ typescript }) => typescript)),
]);
