const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

function assertSecretConfigured() {
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error(
      'JWT_SECRET debe existir en .env y tener al menos 32 caracteres. ' +
      'Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
}

async function hashPassword(plainPassword) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainPassword, salt);
}

function comparePassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

// El token lleva el id del usuario. El rol NO va en el token porque un usuario
// puede tener distinto rol en cada empresa: el rol se valida en cada request
// contra la tabla user_companies, no se confia en lo que diga el token.
function signToken(userId) {
  assertSecretConfigured();
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  assertSecretConfigured();
  return jwt.verify(token, JWT_SECRET); // lanza error si es invalido o expiro
}

module.exports = { hashPassword, comparePassword, signToken, verifyToken };
