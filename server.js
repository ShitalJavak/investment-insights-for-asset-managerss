const express = require('express');
const session = require('express-session');
const path = require('path');
const cfenv = require('cfenv');
const bodyParser = require('body-parser');
const DiscoveryV1 = require('watson-developer-cloud/discovery/v1');
var appEnv = cfenv.getAppEnv()

// libraries for App-ID
const passport = require("passport");
const WebAppStrategy = require("bluemix-appid").WebAppStrategy; // ToDo get from NPM
const helmet = require("helmet");
const flash = require("connect-flash");

const app = express();
var port = process.env.VCAP_APP_PORT || appEnv.port;

var vcapLocal = null;
// declare service variables
var INVESTMENT_PORFOLIO_BASE_URL,INVESTMENT_PORFOLIO_USERNAME,INVESTMENT_PORFOLIO_PASSWORD;
var DISCOVERY_USERNAME, DISCOVERY_PASSWORD;
var SCENARIO_INSTRUMENTS_URI,SCENARIO_INSTRUMENTS_ACCESS_TOKEN;
var PREDICTIVE_MARKET_SCENARIOS_ACCESS_TOKEN,PREDICTIVE_MARKET_SCENARIOS_URI;
var TENANTID, CLIENTID, SECRECT, OAUTHSERVERURL;

if (process.env.VCAP_SERVICES) {
  const env = JSON.parse(process.env.VCAP_SERVICES);

  // Find the service
  if (env['fss-portfolio-service']) {
    INVESTMENT_PORFOLIO_BASE_URL = getHostName(env['fss-portfolio-service'][0].credentials.url);
    INVESTMENT_PORFOLIO_USERNAME = env['fss-portfolio-service'][0].credentials.writer.userid;
    INVESTMENT_PORFOLIO_PASSWORD = env['fss-portfolio-service'][0].credentials.writer.password;
  }

  // Find the service
  if (env['discovery']) {
    console.log("username: " + env['discovery'][0].credentials.username);
    INVESTMENT_PORFOLIO_BASE_URL = getHostName(env['fss-portfolio-service'][0].credentials.url);
    DISCOVERY_USERNAME = env['discovery'][0].credentials.username;
    DISCOVERY_PASSWORD = env['discovery'][0].credentials.password;
  }

  // Find the service
  if (env['fss-scenario-analytics-service']) {
    SCENARIO_INSTRUMENTS_URI = getHostName(env['fss-scenario-analytics-service'][0].credentials.uri);
    SCENARIO_INSTRUMENTS_ACCESS_TOKEN = env['fss-scenario-analytics-service'][0].credentials.accessToken;
  } else {
    console.log('You must bind the Scenario Analytics service to this application');
  }

  // Find the service
  if (env['fss-predictive-scenario-analytics-service']) {
    PREDICTIVE_MARKET_SCENARIOS_URI = getHostName(env['fss-predictive-scenario-analytics-service'][0].credentials.uri);
    PREDICTIVE_MARKET_SCENARIOS_ACCESS_TOKEN = env['fss-predictive-scenario-analytics-service'][0].credentials.accessToken;
  }
  
  // Find the service
  if (env['AppID']) {
    TENANTID = env['AppID'][0].credentials.tenantId;
    CLIENTID = env['AppID'][0].credentials.clientId;
    SECRECT = env['AppID'][0].credentials.secret;
    OAUTHSERVERURL = env['AppID'][0].credentials.oauthServerUrl;
  }
}

//--Config--------------------
require('dotenv').config();

//--Deployment Tracker--------------------
require("cf-deployment-tracker-client").track();

//--Get the app environment from Cloud Foundry, defaulting to local VCAP--------------------
var appEnvOpts = vcapLocal ? {
    vcap: vcapLocal
} : {}
var appEnv = cfenv.getAppEnv(appEnvOpts);

if (appEnv.isLocal) {
    require('dotenv').load();
}

//--Discovery service setup--------------------
var discovery_usernameLocal =  process.env.DISCOVERY_USERNAME;
var discovery_passwordLocal = process.env.DISCOVERY_PASSWORD;
var discovery_environment_id = process.env.DISCOVERY_environment_id;
var discovery_collection_id = process.env.DISCOVERY_collection_id;

var discovery = new DiscoveryV1({
  username: discovery_usernameLocal || DISCOVERY_USERNAME,
  password: discovery_passwordLocal || DISCOVERY_PASSWORD,
  version_date: '2017-08-01'
});

//--AppID service setup--------------------
var tenantIdLocal =  process.env.TENANTID;
var clientIdLocal = process.env.CLIENTID;
var secretLocal =  process.env.SECRECT;
var oauthServerUrlLocal = process.env.OAUTHSERVERURL;


//--Setting up the middle ware--------------------
app.use(session({
	secret: "finance-trade-app",
	resave: true,
	saveUninitialized: true
}));
app.use('/', express.static(__dirname + '/app'));

//--used for AppID - Helmet helps to secure Express apps by setting various HTTP headers
app.use(helmet());
app.use(flash());

//TODO:Remove
app.use('/node_modules',express.static(__dirname + '/node_modules'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());


// Configure express application to use passportjs
app.use(passport.initialize());
app.use(passport.session());


// Configure passportjs to use AppID WebAppStrategy
passport.use(new WebAppStrategy({
	tenantId: tenantIdLocal,
	clientId: clientIdLocal,
	secret: secretLocal,
	oauthServerUrl: oauthServerUrlLocal,
	redirectUri: appEnv.url + "/auth/callback" 
}));

// Configure passportjs with user serialization/deserialization. This is required
// for authenticated session persistence accross HTTP requests. See passportjs docs
// for additional information http://passportjs.org/docs
passport.serializeUser(function(user, cb) {
	cb(null, user);
});

passport.deserializeUser(function(obj, cb) {
	cb(null, obj);
});

// Explicit login endpoint. Will always redirect browser to login widget due to {forceLogin: true}.
// If forceLogin is set to false redirect to login widget will not occur of already authenticated users.
app.get('/auth/login', passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
	successRedirect: '/#!/dashboard',
	forceLogin: true
}));

// Explicit anonymous login endpoint. Will always redirect browser for anonymous login due to forceLogin: true
app.get('/auth/loginanon', passport.authenticate(WebAppStrategy.STRATEGY_NAME, {
	successRedirect: '/#!/dashboard',
	allowAnonymousLogin: true,
	allowCreateNewAnonymousUser: true
}));

// routes for user authentication
app.use(require('./routes/auth.js'));

// Callback to finish the authorization process. Will retrieve access and identity tokens/
// from App ID service and redirect to either (in below order)
// 1. the original URL of the request that triggered authentication, as persisted in HTTP session under WebAppStrategy.ORIGINAL_URL key.
// 2. successRedirect as specified in passport.authenticate(name, {successRedirect: "...."}) invocation
// 3. application root ("/")
app.get('/auth/callback', passport.authenticate(WebAppStrategy.STRATEGY_NAME));

// Logout endpoint. Clears authentication information from session
app.get('/auth/logout', function(req, res){
	WebAppStrategy.logout(req);
	res.redirect('/');
});


// protect all routes under /api/v1
function checkAuthenticated(req, res, next) {
  // if (req.session && req.session.logged) {
  if (req.isAuthenticated()) {
  next();
  } else {
    res.sendStatus(401);
  }
}
app.use('/api/v1/', checkAuthenticated);

// register API routes
app.use(require('./routes/portfolios.js')({
  baseUrl: INVESTMENT_PORFOLIO_BASE_URL || process.env.INVESTMENT_PORFOLIO_BASE_URL,
  userid: INVESTMENT_PORFOLIO_USERNAME || process.env.INVESTMENT_PORFOLIO_USERNAME,
  password: INVESTMENT_PORFOLIO_PASSWORD || process.env.INVESTMENT_PORFOLIO_PASSWORD,
}));
app.use(require('./routes/news.js')(discovery));
app.use(require('./routes/simulation')({
  uri: SCENARIO_INSTRUMENTS_URI || process.env.SIMULATED_INSTRUMENT_ANALYSIS_URI,
  accessToken: SCENARIO_INSTRUMENTS_ACCESS_TOKEN || process.env.SIMULATED_INSTRUMENT_ANALYSIS_ACCESS_TOKEN
}, {
  uri: PREDICTIVE_MARKET_SCENARIOS_URI || process.env.PREDICTIVE_MARKET_SCENARIOS_URI,
  accessToken: PREDICTIVE_MARKET_SCENARIOS_ACCESS_TOKEN || process.env.PREDICTIVE_MARKET_SCENARIOS_ACCESS_TOKEN
}));

//--All other routes to be sent to home page--------------------
app.get('/*', function(req, res) {
  res.sendFile(path.join(__dirname + '/app/index.html'));
});

function getHostName(url) {
  var match = url.match(/:\/\/(www[0-9]?\.)?(.[^/:]+)/i);
  if (match != null && match.length > 2 && typeof match[2] === 'string' && match[2].length > 0) {
    return match[2];
  } else {
    return null;
  }
}

//--launch--------------------
app.listen(port, "0.0.0.0", () => {
  // print a message when the server starts listening
  console.log("server running on  http://localhost:" + port);
});
