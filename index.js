const Koa = require('koa');
const BodyParser = require('koa-body');
const Router = require('koa-router');
const Datastore = require('nedb');
const crypto = require('crypto');
const qr = require('qr-encoder');

const baseUrl = 'ngrm.link';
const port = 4567;

const app = new Koa();
const router = new Router();
const db = new Datastore({ filename: 'main.db', autoload: true });

const encrypt = (key, value) => {
  const cipher = crypto.createCipher('aes256', key);
  return cipher.update(value, 'utf8', 'hex') + cipher.final('hex');
};
const decrypt = (key, value) => {
  const decipher = crypto.createDecipher('aes256', key);
  return decipher.update(value, 'hex', 'utf8') + decipher.final('utf8');
};
const hash = value =>
  crypto
    .createHash('sha256')
    .update(value)
    .digest('base64');

const codeLength = 8;
const codeParts =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890';

async function generateShortCode() {
  while (true) {
    const generated = Array(codeLength)
      .fill(0)
      .map(_ => codeParts[Math.floor(Math.random() * codeParts.length)])
      .join('');

    const hashed = hash(generated);

    const exists = await new Promise(resolve =>
      db.findOne(
        { $or: [{ hashedLinkCode: hashed }, { puzzleCode: generated }] },
        (err, record) => {
          resolve(!!record);
        }
      )
    );

    if (exists) {
      console.log('Wow we hit a collision');
      continue;
    } else {
      return [generated, hashed];
    }
  }
}

router
  .post('/link', BodyParser(), async ctx => {
    const link = ctx.request.body.link;
    const [linkCode, hashedLinkCode] = await generateShortCode();
    const [puzzleCode] = await generateShortCode();
    const encryptedLink = encrypt(linkCode, link);
    const qrCode = qr.encode(baseUrl + '/#' + linkCode, 2);

    await new Promise((resolve, reject) =>
      db.insert(
        {
          hashedLinkCode,
          encryptedLink,
          puzzleCode,
          qrCode
        },
        err => {
          if (err) reject(err);
          else resolve();
        }
      )
    );

    ctx.body = {
      qrCode,
      puzzleCode
    };
  })
  .get('/link/:code', async ctx => {
    const linkCode = ctx.params.code;

    const url = await new Promise((resolve, reject) => {
      const hashedLinkCode = hash(linkCode);
      db.findOne({ hashedLinkCode }, (err, doc) => {
        if (err) {
          reject(err);
        }

        if (doc) {
          const encryptedLink = doc.encryptedLink;
          resolve(decrypt(linkCode, encryptedLink));
        } else {
          resolve(undefined);
        }
      });
    });

    if (url) {
      ctx.body = { url };
    } else {
      ctx.response.status = 404;
    }
  })
  .get('/puzzle/:code', async ctx => {
    const puzzleCode = ctx.params.code;

    const qrCode = await new Promise((resolve, reject) =>
      db.findOne({ puzzleCode }, (err, doc) => {
        if (err) {
          reject(err);
        }

        if (doc) {
          resolve(doc.qrCode);
        } else {
          resolve(undefined);
        }
      })
    );

    if (qrCode) {
      ctx.body = { qrCode };
    } else {
      ctx.response.status = 404;
    }
  });

app.use(async (ctx, next) => {
  ctx.set('Access-Control-Allow-Origin', '*');
  ctx.set('Access-Control-Allow-Methods', 'GET');
  ctx.set('Access-Control-Allow-Headers', 'Content-Type');

  await next();
});
app.use(router.routes());

app.listen(port);
console.log('Now listening on port ' + port);
