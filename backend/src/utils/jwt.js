const jwt = require('jsonwebtoken');

const SECRET = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  return process.env.JWT_SECRET;
};

function sign(payload, options = {}) {
  return jwt.sign(payload, SECRET(), { expiresIn: '30d', ...options });
}

function verify(token) {
  return jwt.verify(token, SECRET());
}

module.exports = { sign, verify };
