function findSellerByEmail(data, email) {
  const target = String(email || '').toLowerCase();
  return data.sellers.find((s) => s.email.toLowerCase() === target);
}

function findSellerById(data, sellerId) {
  return data.sellers.find((s) => s.seller_id === sellerId);
}

module.exports = { findSellerByEmail, findSellerById };
