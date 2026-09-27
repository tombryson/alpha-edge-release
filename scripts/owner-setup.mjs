import { createHash, randomBytes } from 'node:crypto';

const token = randomBytes(32).toString('base64url');
console.log('Keep this setup token offline. Enter it once on your private enrollment page:');
console.log(token);
console.log('\nSet only this digest on the owner BACKEND, using your secret manager:');
console.log(`OWNER_SETUP_TOKEN_SHA256=${createHash('sha256').update(token).digest('hex')}`);
console.log('\nThis creates no account, changes no database, and deploys nothing.');
