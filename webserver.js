#!/usr/bin/env node
'use strict';

// Init

require('dotenv').config();
const
  debug = require('debug')('webapp'),
  debugSrv = require('debug')('server'),
  express = require('express'),
  RateLimit = require('express-rate-limit'),
  helmet = require('helmet'),
  compression = require('compression'),
  app = express();
var
  port = process.env.PORT || 8000,
  host = process.env.HOST || '0.0.0.0';

// Middleware

app.enable('trust proxy');

var limiter = new RateLimit({
  windowMs: 15*60*1000,
  delayAfter: 100,
  delayMs: 3*1000,
  max: 200,
  message: "Flood limit"
});
app.use(limiter);

app.use(helmet());
app.use(compression());

app.use(express.static('public'));
app.use(express.static('vc-core'));

// Routes

app.use('/', express.static('./public/index.html'));
app.use((req, res) => res.redirect('/'))

// Listen

let server = app.listen(port, host, err => {
  if (err) debug('*err %O', err);
  debugSrv('Listening on port %d', server.address().port)
})
