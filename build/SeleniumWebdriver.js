'use strict';
let webdriver, until;

const Helper = require('../helper');
const stringIncludes = require('../assert/include').includes;
const urlEquals = require('../assert/equal').urlEquals;
const equals = require('../assert/equal').equals;
const empty = require('../assert/empty').empty;
const truth = require('../assert/truth').truth;
const xpathLocator = require('../utils').xpathLocator;
const fileExists = require('../utils').fileExists;
const co = require('co');
const path = require('path');
const recorder = require('../recorder');

let withinStore = {};

/**
 * SeleniumWebdriver helper is based on the official [Selenium Webdriver JS](https://www.npmjs.com/package/selenium-webdriver)
 * library. It implements common web api methods (amOnPage, click, see).
 *
 * #### Selenium Installation
 *
 * 1. Download [Selenium Server](http://docs.seleniumhq.org/download/)
 * 2. Launch the daemon: `java -jar selenium-server-standalone-2.xx.xxx.jar`
 *
 *
 * #### PhantomJS Installation
 *
 * PhantomJS is a headless alternative to Selenium Server that implements [the WebDriver protocol](https://code.google.com/p/selenium/wiki/JsonWireProtocol).
 * It allows you to run Selenium tests on a server without a GUI installed.
 *
 * 1. Download [PhantomJS](http://phantomjs.org/download.html)
 * 2. Run PhantomJS in WebDriver mode: `phantomjs --webdriver=4444`
 *
 * ### Configuration
 *
 * This helper should be configured in codecept.json
 *
 * * `url` - base url of website to be tested
 * * `browser` - browser in which perform testing
 * * `driver` - which protrator driver to use (local, direct, session, hosted, sauce, browserstack). By default set to 'hosted' which requires selenium server to be started.
 * * `seleniumAddress` - Selenium address to connect (default: http://localhost:4444/wd/hub)
 * * `waitForTimeout`: (optional) sets default wait time in _ms_ for all `wait*` functions. 1000 by default;
 *
 * other options are the same as in [Protractor config](https://github.com/angular/protractor/blob/master/docs/referenceConf.js).
 */
class SeleniumWebdriver extends Helper {

  constructor(config) {
    super(config);

    webdriver = require('selenium-webdriver');
    until = require('selenium-webdriver').until;

    this.options = {
      browser: 'firefox',
      url: 'http://localhost',
      seleniumAddress: 'http://localhost:4444/wd/hub',
      waitforTimeout: 1000, // ms
      capabilities: {}
    };
    this.options = Object.assign(this.options, config);
    this.options.waitforTimeout /= 1000; // convert to seconds

  }

  _init() {
    global.by = require('selenium-webdriver').By;
    this.context = 'body'
    this.options.rootElement = 'body' // protractor compat

    this.browserBuilder = new webdriver.Builder()
      .withCapabilities(this.options.capabilities)
      .forBrowser(this.options.browser)
      .usingServer(this.options.seleniumAddress);

    if (this.options.proxy) this.browserBuilder.setProxy(this.options.proxy);
  }

  static _require()
  {
    try {
      require.resolve("selenium-webdriver");
    } catch(e) {
      return ["selenium-webdriver@~2.48.2"];
    }
  }

  static _config() {
    return [
      { name: 'url', message: "Base url of site to be tested", default: 'http://localhost' },
      { name: 'browser', message: 'Browser in which testing will be performed', default: 'firefox' },
    ];
  }

  _before() {
    return this.browser = this.browserBuilder.build();
  }

  _after() {
    return this.browser.quit();
  }

  _failed(test) {
    let fileName = test.title.replace(/ /g, '_') + '.failed.png';
    return this.saveScreenshot(fileName);
  }

  _withinBegin(locator) {
    withinStore.elFn = this.browser.findElement;
    withinStore.elsFn = this.browser.findElements;

    this.context = locator;
    let context = this.browser.findElement(guessLocator(locator) || by.css(locator));

    this.browser.findElement = (l) => context.findElement(l);
    this.browser.findElements = (l) => context.findElements(l);
  }

  _withinEnd() {
    this.browser.findElement = withinStore.elFn;
    this.browser.findElements = withinStore.elsFn;
    this.context = this.options.rootElement;
  }

  /**
   * Opens a web page in a browser. Requires relative or absolute url.
If url starts with `/`, opens a web page of a site defined in `url` config parameter.

```js
I.amOnPage('/'); // opens main page of website
I.amOnPage('https://github.com'); // opens github
I.amOnPage('/login'); // opens a login page
```

@param url url path or global url
   */
  amOnPage(url) {
    if (url.indexOf('http') !== 0) {
      url = this.options.url + url;
    }
    return this.browser.get(url);
  }

  /**
   * Perform a click on a link or a button, given by a locator.
If a fuzzy locator is given, the page will be searched for a button, link, or image matching the locator string.
For buttons, the "value" attribute, "name" attribute, and inner text are searched. For links, the link text is searched.
For images, the "alt" attribute and inner text of any parent links are searched.

The second parameter is a context (CSS or XPath locator) to narrow the search.

```js
// simple link
I.click('Logout');
// button of form
I.click('Submit');
// CSS button
I.click('#form input[type=submit]');
// XPath
I.click('//form/*[@type=submit]');
// link in context
I.click('Logout', '#nav');
// using strict locator
I.click({css: 'nav a.login'});
```
@param link clickable link or button located by text, or any element located by CSS|XPath|strict locator
@param context (optional) element to search in CSS|XPath|Strict locator
   */
  click(link, context) {
    let matcher = this.browser;
    if (context) {
      matcher = matcher.findElement(guessLocator(context) || by.css(context));
    }
    return co(findClickable(matcher, link)).then((el) => el.click());
  }

  /**
   * Performs a double-click on an element matched by CSS or XPath.
   */
  doubleClick(link, context) {
    let matcher = this.browser;
    if (context) {
      matcher = matcher.findElement(guessLocator(context) || by.css(context));
    }
    return co(findClickable(matcher, link)).then((el) => el.doubleClick());
  }

  /**
   * Checks that a page contains a visible text.
Use context parameter to narrow down the search.

```js
I.see('Welcome'); // text welcome on a page
I.see('Welcome', '.content'); // text inside .content div
I.see('Register', {css: 'form.register'}); // use strict locator
```
@param text expected on page
@param context (optional) element located by CSS|Xpath|strict locator in which to search for text
   */
  see(text, context) {
    return proceedSee.call(this, 'assert', text, context);
  }

  /**
   * Opposite to `see`. Checks that a text is not present on a page.
Use context parameter to narrow down the search.

```js
I.dontSee('Login'); // assume we are already logged in
```
@param text is not present
@param context (optional) element located by CSS|XPath|strict locator in which to perfrom search
   */
  dontSee(text, context) {
    return proceedSee.call(this, 'negate', text, context);
  }

  /**
   * Selects an option in a drop-down select.
Field is siearched by label | name | CSS | XPath.
Option is selected by visible text or by value.

```js
I.selectOption('Choose Plan', 'Monthly'); // select by label
I.selectOption('subscription', 'Monthly'); // match option by text
I.selectOption('subscription', '0'); // or by value
I.selectOption('//form/select[@name=account]','Permium');
I.selectOption('form select[name=account]', 'Premium');
I.selectOption({css: 'form select[name=account]'}, 'Premium');
```

Provide an array for the second argument to select multiple options.

```js
I.selectOption('Which OS do you use?', ['Andriod', 'OSX']);
```
@param select field located by label|name|CSS|XPath|strict locator
@param option
   */
  selectOption(select, option) {
    return co(findFields(this.browser, select)).then(co.wrap(function*(fields) {
      if (!fields.length) {
        throw new Error(`Selectable field ${select} not found by name|text|CSS|XPath`);
      }
      if (!Array.isArray(option)) {
        option = [option];
      }
      let field = fields[0];
      let promises = [];
      for (let key in option) {
        let opt = option[key];
        let normalizedText = `[normalize-space(.) = "${opt.trim() }"]`;
        let byVisibleText = `./option${normalizedText}|./optgroup/option${normalizedText}`;
        let els = yield field.findElements(by.xpath(byVisibleText));
        if (!els.length) {
          let normalizedValue = `[normalize-space(@value) = "${opt.trim() }"]`;
          let byValue = `./option${normalizedValue}|./optgroup/option${normalizedValue}`;
          els = yield field.findElements(by.xpath(byValue));
        }
        els.forEach((el) => promises.push(el.click()));
      }
      return Promise.all(promises);
    }));
  }

  /**
   * Fills a text field or textarea, after clearing its value,  with the given string.
Field is located by name, label, CSS, or XPath.

```js
// by label
I.fillField('Email', 'hello@world.com');
// by name
I.fillField('password', '123456');
// by CSS
I.fillField('form#login input[name=username]', 'John');
// or by strict locator
I.fillField({css: 'form#login input[name=username]'}, 'John');
```
@param field located by label|name|CSS|XPath|strict locator
@param value
   */
  fillField(field, value) {
    return co(findFields(this.browser, field)).then(co.wrap(function*(els) {
      if (!els.length) {
        throw new Error(`Field ${field} not found by name|text|CSS|XPath`);
      }
      yield els[0].clear();
      return els[0].sendKeys(value);
    }));
  }

  /**
   * Presses a key on a focused element.
Speical keys like 'Enter', 'Control', [etc](https://code.google.com/p/selenium/wiki/JsonWireProtocol#/session/:sessionId/element/:id/value)
will be replaced with corresponding unicode.
If modiferier key is used (Control, Command, Alt, Shift) in array, it will be released afterwards.

```js
I.pressKey('Enter');
I.pressKey(['Control','a']);
```
@param key
   */
  pressKey(key) {
    let modifier;
    if (Array.isArray(key) && ~['Control','Command','Shift','Alt'].indexOf(key[0])) {
      modifier = webdriver.Key[key[0].toUpperCase()];
      key = key[1];
    }
    if (key == 'Enter') {
       key = webdriver.Key.ENTER;
    }

    let action = new webdriver.ActionSequence(this.browser);
    if (modifier) action.keyDown(modifier)
    action.sendKeys(key);
    if (modifier) action.keyUp(modifier)
    return action.perform();
  }

  /**
   * Attaches a file to element located by label, name, CSS or XPath
Path to file is relative current codecept directory (where codecept.json is located).
File will be uploaded to remove system (if tests are running remotely).

```js
I.attachFile('Avatar', 'data/avatar.jpg');
I.attachFile('form input[name=avatar]', 'data/avatar.jpg');
```
@param locator field located by label|name|CSS|XPath|strict locator
@param pathToFile local file path relative to codecept.json config file
   */
  attachFile(locator, pathToFile) {
    let file = path.join(global.codecept_dir, pathToFile);
    if (!fileExists(file)) {
      throw new Error(`File at ${file} can not be found on local system`);
    }
    return co(findFields(this.browser, locator)).then((els) => {
      if (!els.length) {
        throw new Error(`Field ${locator} not found by name|text|CSS|XPath`);
      }
      if (this.options.browser !== 'phantomjs') {
        var remote = require('selenium-webdriver/remote');
        this.browser.setFileDetector(new remote.FileDetector());
      }
      return els[0].sendKeys(file);
     });
  }

  /**
   * Checks that the given input field or textarea equals to given value.
For fuzzy locators, fields are matched by label text, the "name" attribute, CSS, and XPath.

```js
I.seeInField('Username', 'davert');
I.seeInField({css: 'form textarea'},'Type your comment here');
I.seeInField('form input[type=hidden]','hidden_value');
I.seeInField('#searchform input','Search');
```
@param field located by label|name|CSS|XPath|strict locator
@param value
   */
  seeInField(field, value) {
    return co.wrap(proceedSeeInField).call(this, 'assert', field, value);
  }

  /**
   * Checks that value of input field or textare doesn't equal to given value
Opposite to `seeInField`.

@param field located by label|name|CSS|XPath|strict locator
@param value is not expected to be a field value
   */
  dontSeeInField(field, value) {
    return co.wrap(proceedSeeInField).call(this, 'negate', field, value);
  }

  /**
   * Appends text to a input field or textarea.
Field is located by name, label, CSS or XPath

```js
I.appendField('#myTextField', 'appended');
```
@param field located by label|name|CSS|XPath|strict locator
@param value text value
   */
  appendField(field, value) {
    return co(findFields(this.browser, field)).then(co.wrap(function*(els) {
      if (!els.length) {
        throw new Error(`Field ${field} not found by name|text|CSS|XPath`);
      }
      return els[0].sendKeys(value);
    }));
  }

  /**
   * Selects a checkbox or radio button.
Element is located by label or name or CSS or XPath.

The second parameter is a context (CSS or XPath locator) to narrow the search.

```js
I.checkOption('#agree');
I.checkOption('I Agree to Terms and Conditions');
I.checkOption('agree', '//form');
```
@param option located by label | name | CSS | XPath | strict locator
@param context (optional) element located by CSS | XPath | strict locator
   */
  checkOption(option, context) {
    let matcher = this.browser;
    if (context) {
      matcher = matcher.findElement(guessLocator(context) || by.css(context));
    }
    return co(findCheckable(matcher, option)).then((els) => {
      if (!els.length) {
        throw new Error(`Option ${option} not found by name|text|CSS|XPath`);
      }
      return els[0].isSelected().then((selected) => {
        if (!selected) return els[0].click();
      });
    });
  }

  /**
   * Verifies that the specified checkbox is checked.

```js
I.seeCheckboxIsChecked('Agree');
I.seeCheckboxIsChecked('#agree'); // I suppose user agreed to terms
I.seeCheckboxIsChecked({css: '#signup_form input[type=checkbox]'});
```
@param field located by label|name|CSS|XPath|strict locator
   */
  seeCheckboxIsChecked(option)
  {
    return co.wrap(proceedIsChecked).call(this, 'assert', option);
  }

  /**
   *  Verifies that the specified checkbox is not checked.

 @param field located by label|name|CSS|XPath|strict locator
   */
  dontSeeCheckboxIsChecked(option)
  {
    return co.wrap(proceedIsChecked).call(this, 'negate', option);
  }

  /**
   * Retrieves a text from an element located by CSS or XPath and returns it to test.
Resumes test execution, so **should be used inside a generator with `yield`** operator.

```js
let pin = yield I.grabTextFrom('#pin');
```
@param locator element located by CSS|XPath|strict locator
   */
  grabTextFrom(locator) {
    return this.browser.findElement(guessLocator(locator) || by.css(locator)).getText();
  }

  /**
   * Retrieves a value from a form element located by CSS or XPath and returns it to test.
Resumes test execution, so **should be used inside a generator with `yield`** operator.

```js
let email = yield I.grabValueFrom('input[name=email]');
```
@param locator field located by label|name|CSS|XPath|strict locator
   */
  grabValueFrom(locator) {
    return co(findFields(this.browser, locator)).then(function(els) {
      if (!els.length) {
        throw new Error(`Field ${locator} was not located by name|label|CSS|XPath`);
      }
      return els[0].getAttribute('value');
    });
  }

  /**
   * Retrieves an attribute from an element located by CSS or XPath and returns it to test.
Resumes test execution, so **should be used inside a generator with `yield`** operator.

```js
let hint = yield I.grabAttributeFrom('#tooltip', 'title');
```
@param locator element located by CSS|XPath|strict locator
@param attr
   */
  grabAttributeFrom(locator, attr) {
    return this.browser.findElement(guessLocator(locator) || by.css(locator)).getAttribute(attr);
  }

  /**
   * Checks that title contains text.

@param text
   */
  seeInTitle(text) {
    return this.browser.getTitle().then((title) => {
      return stringIncludes('web page title').assert(text, title);
    });
  }

  /**
   * Checks that title does not contain text.

@param text
   */
  dontSeeInTitle(text) {
    return this.browser.getTitle().then((title) => {
      return stringIncludes('web page title').negate(text, title);
    });
  }

  /**
   * Retrieves a page title and returns it to test.
Resumes test execution, so **should be used inside a generator with `yield`** operator.

```js
let title = yield I.grabTitle();
```
   */
  grabTitle() {
    return this.browser.getTitle().then((title) => {
      this.debugSection('Title', title);
      return title;
    });
  }

  /**
   * Checks that a given Element is visible
Element is located by CSS or XPath.

```js
I.seeElement('#modal');
```
@param locator located by CSS|XPath|strict locator
   */
  seeElement(locator) {
    return this.browser.findElements(guessLocator(locator) || by.css(locator)).then((els) => {
      return Promise.all(els.map((el) => el.isDisplayed())).then((els) => {
        return empty('elements').negate(els.filter((v) => v).fill('ELEMENT'));
      });
    });
  }

  /**
   * Opposite to `seeElement`. Checks that element is not visible

@param locator located by CSS|XPath|Strict locator
   */
  dontSeeElement(locator) {
    return this.browser.findElements(guessLocator(locator) || by.css(locator)).then((els) => {
      return Promise.all(els.map((el) => el.isDisplayed())).then((els) => {
        return empty('elements').assert(els.filter((v) => v).fill('ELEMENT'));
      });
    });
  }

  /**
   * Checks that a given Element is present in the DOM
Element is located by CSS or XPath.

```js
I.seeElementInDOM('#modal');
```
@param locator located by CSS|XPath|strict locator
   */
  seeElementInDOM(locator) {
    return this.browser.findElements(guessLocator(locator) || by.css(locator)).then((els) => {
      return empty('elements').negate(els.fill('ELEMENT'));
    });
  }

  /**
   * Opposite to `seeElementInDOM`. Checks that element is not on page.

@param locator located by CSS|XPath|Strict locator
   */
  dontSeeElementInDOM(locator) {
    return this.browser.findElements(guessLocator(locator) || by.css(locator)).then((els) => {
      return empty('elements').assert(els.fill('ELEMENT'));
    });
  }

  /**
   * Checks that the current page contains the given string in its raw source code.

```js
I.seeInSource('<h1>Green eggs &amp; ham</h1>');
```
@param text
   */
  seeInSource(text) {
    return this.browser.getPageSource().then((source) => {
      return stringIncludes('HTML source of a page').assert(text, source);
    });
  }

  /**
   * Checks that the current page contains the given string in its raw source code

@param text
   */
  dontSeeInSource(text) {
    return this.browser.getPageSource().then((source) => {
      return stringIncludes('HTML source of a page').negate(text, source);
    });
  }

  /**
   * Executes sync script on a page.
Pass arguments to function as additional parameters.
Will return execution result to a test.
In this case you should use generator and yield to receive results.

@param fn
   */
  executeScript(fn) {
    return this.browser.execute.apply(this.browser, arguments);
  }

  /**
   * Executes async script on page.
Provided function should execute a passed callback (as first argument) to signal it is finished.

@param fn
   */
  executeAsyncScript(fn) {
    return this.browser.executeAsync.apply(this.browser, arguments);
  }

  /**
   * Checks that current url contains a provided fragment.

```js
I.seeInCurrentUrl('/register'); // we are on registration page
```
@param url
   */
  seeInCurrentUrl(url) {
    return this.browser.getCurrentUrl().then(function (currentUrl) {
      return stringIncludes('url').assert(url, currentUrl);
    });
  }

  /**
   * Checks that current url does not contain a provided fragment.

@param url
   */
  dontSeeInCurrentUrl(url) {
    return this.browser.getCurrentUrl().then(function (currentUrl) {
      return stringIncludes('url').negate(url, currentUrl);
    });
  }

  /**
   * Checks that current url is equal to provided one.
If a relative url provided, a configured url will be prepended to it.
So both examples will work:

```js
I.seeCurrentUrlEquals('/register');
I.seeCurrentUrlEquals('http://my.site.com/register');
```
@param url
   */
  seeCurrentUrlEquals(url) {
    return this.browser.getCurrentUrl().then((currentUrl) => {
      return urlEquals(this.options.url).assert(url, currentUrl);
    });
  }

  /**
   * Checks that current url is not equal to provided one.
If a relative url provided, a configured url will be prepended to it.

@param url
   */
  dontSeeCurrentUrlEquals(url) {
    return this.browser.getCurrentUrl().then((currentUrl) => {
      return urlEquals(this.options.url).negate(url, currentUrl);
    });
  }

  /**
   * Saves a screenshot to ouput folder (set in codecept.json).
Filename is relative to output folder.

```js
I.saveScreenshot('debug.png');
```
@param fileName
   */
  saveScreenshot(fileName) {
    let outputFile = path.join(global.output_dir, fileName);
    this.debug('Screenshot has been saved to ' + outputFile);
    return this.browser.takeScreenshot().then(function(png) {
      let fs = require('fs');
      var stream = fs.createWriteStream(outputFile);
      stream.write(new Buffer(png, 'base64'));
      stream.end();
      return new Promise(function(resolve) {
        return stream.on('finish', resolve);
      });
    });
  }

  /**
   * Sets a cookie

```js
I.setCookie({name: 'auth', value: true});
```
@param cookie
   *
   *
   */
  setCookie(cookie) {
    let cookieArray = [];
    if (cookie.name) cookieArray.push(cookie.name);
    if (cookie.value) cookieArray.push(cookie.value);
    if (cookie.path) cookieArray.push(cookie.path);
    if (cookie.domain) cookieArray.push(cookie.domain);
    if (cookie.secure) cookieArray.push(cookie.secure);
    if (cookie.expiry) cookieArray.push(cookie.expiry);

    let manage = this.browser.manage();
    return manage.addCookie.apply(manage, cookieArray);
  }

  /**
   * Clears a cookie by name,
if none provided clears all cookies

```js
I.clearCookie();
I.clearCookie('test');
```
@param cookie (optional)
   */
  clearCookie(cookie) {
    if (cookie) {
      return this.browser.manage().deleteAllCookies();
    }
    return this.browser.manage().deleteCookie(cookie);
  }

  /**
   * Checks that cookie with given name exists.

```js
I.seeCookie('Auth');
```
@param name
   */
  seeCookie(name) {
    return this.browser.manage().getCookie(name).then(function (res) {
      return truth('cookie ' + name, 'to be set').assert(res);
    });
  }

  /**
   * Checks that cookie with given name does not exist.

@param name
   */
  dontSeeCookie(name) {
    return this.browser.manage().getCookie(name).then(function (res) {
      return truth('cookie ' + name, 'to be set').negate(res);
    });
  }

  /**
   * Gets a cookie object by name
* Resumes test execution, so **should be used inside a generator with `yield`** operator.

```js
let cookie = I.grabCookie('auth');
assert(cookie.value, '123456');
```
@param name
   *
   * Returns cookie in JSON [format](https://code.google.com/p/selenium/wiki/JsonWireProtocol#Cookie_JSON_Object).
   */
  grabCookie(name) {
    return this.browser.manage().getCookie(name);
  }

  /**
   * Resize the current window to provided width and height.
First parameter can be set to `maximize`

@param width or `maximize`
@param height
   */
  resizeWindow(width, height) {
    if (width === 'maximize') {
      return this.browser.manage().window().maximize();
    }
    return this.browser.manage().window().setSize(width, height);
  }

  /**
   * Pauses execution for a number of seconds.

```js
I.wait(2); // wait 2 secs
```

@param sec
   */
  wait(sec) {
    return this.browser.sleep(sec * 1000);
  }

  /**
   * Waits for element to be present on page (by default waits for 1sec).
Element can be located by CSS or XPath.

```js
I.waitForElement('.btn.continue');
I.waitForElement('.btn.continue', 5); // wait for 5 secs
```

@param locator element located by CSS|XPath|strict locator
@param sec time seconds to wait, 1 by default
   */
  waitForElement(locator, sec) {
    sec = sec || this.options.waitforTimeout;
    let el = this.browser.findElement(guessLocator(locator) || by.css(locator));
    return this.browser.wait(until.elementsLocated(el), sec*1000);
  }

  /**
   * Waits for an element to become visible on a page (by default waits for 1sec).
Element can be located by CSS or XPath.

```
I.waitForVisible('#popup');
```

@param locator element located by CSS|XPath|strict locator
@param sec time seconds to wait, 1 by default
   */
  waitForVisible(locator, sec) {
    sec = sec || this.options.waitforTimeout;
    let el = this.browser.findElement(guessLocator(locator) || by.css(locator));
    return this.browser.wait(until.elementIsVisible(el), sec*1000);
  }

  /**
   * Waits for a text to appear (by default waits for 1sec).
Element can be located by CSS or XPath.
Narrow down search results by providing context.

```js
I.waitForText('Thank you, form has been submitted');
I.waitForText('Thank you, form has been submitted', 5, '#modal');
```

@param text to wait for
@param sec seconds to wait
@param context element located by CSS|XPath|strict locator
   */
  waitForText(text, sec, context) {
    if (!context) {
      context = this.context;
    }
    let el = this.browser.findElement(guessLocator(context) || by.css(context));
    sec = sec || this.options.waitforTimeout;
    return this.browser.wait(until.elementTextIs(el, text), sec*1000);
  }

}

module.exports = SeleniumWebdriver;

function *findCheckable(client, locator) {
  let matchedLocator = guessLocator(locator);
  if (matchedLocator) {
    return client.findElements(matchedLocator);
  }
  let literal = xpathLocator.literal(locator);
  let byText = xpathLocator.combine([
    `.//input[@type = 'checkbox' or @type = 'radio'][(@id = //label[contains(normalize-space(string(.)), ${literal})]/@for) or @placeholder = ${literal}]`,
    `.//label[contains(normalize-space(string(.)), ${literal})]//input[@type = 'radio' or @type = 'checkbox']`
  ]);
  let els = yield client.findElements(by.xpath(byText));
  if (els.length) {
    return els;
  }
  let byName = `.//input[@type = 'checkbox' or @type = 'radio'][@name = ${literal}]`;
  els = yield client.findElements(by.xpath(byName));
  if (els.length) {
    return els;
  }
  return yield client.findElements(by.css(locator));
}

function *findFields(client, locator) {
  let matchedLocator = guessLocator(locator);
  if (matchedLocator) {
    return client.findElements(matchedLocator);
  }
  let literal = xpathLocator.literal(locator);

  let byLabelEquals = xpathLocator.combine([
    `.//*[self::input | self::textarea | self::select][not(./@type = 'submit' or ./@type = 'image' or ./@type = 'hidden')][((./@name = ${literal}) or ./@id = //label[normalize-space(string(.)) = ${literal}]/@for or ./@placeholder = ${literal})]`,
    `.//label[normalize-space(string(.)) = ${literal}]//.//*[self::input | self::textarea | self::select][not(./@type = 'submit' or ./@type = 'image' or ./@type = 'hidden')]`
  ]);
  let els = yield client.findElements(by.xpath(byLabelEquals));
  if (els.length) {
    return els;
  }

  let byLabelContains = xpathLocator.combine([
    `.//*[self::input | self::textarea | self::select][not(./@type = 'submit' or ./@type = 'image' or ./@type = 'hidden')][(((./@name = ${literal}) or ./@id = //label[contains(normalize-space(string(.)), ${literal})]/@for) or ./@placeholder = ${literal})]`,
    `.//label[contains(normalize-space(string(.)), ${literal})]//.//*[self::input | self::textarea | self::select][not(./@type = 'submit' or ./@type = 'image' or ./@type = 'hidden')]`
  ]);
  els = yield client.findElements(by.xpath(byLabelContains));
  if (els.length) {
    return els;
  }
  let byName = `.//*[self::input | self::textarea | self::select][@name = ${literal}]`;
  els = yield client.findElements(by.xpath(byName));
  if (els.length) {
    return els;
  }
  return yield client.findElements(by.css(locator));
}

function proceedSee(assertType, text, context) {
  let description, locator;
  if (!context) {
    if (this.context === this.options.rootElement) {
      locator = guessLocator(this.context) || by.css(this.context);
      description = 'web application';
    } else {
      locator = null;
      description = 'current context ' + this.context;
    }
  } else {
    locator = guessLocator(context) || by.css(context);
    description = 'element ' + context;
  }
  return this.browser.findElements(locator).then(co.wrap(function*(els) {
    let promises = [];
    let source = '';
    els.forEach(el => promises.push(el.getText().then((elText) => source+= '| ' + elText)));
    yield Promise.all(promises);
    return stringIncludes(description)[assertType](text, source);
  }));
}

function *proceedSeeInField(assertType, field, value) {
  let els = yield co(findFields(this.browser, field));
  if (!els.length) {
    throw new Error(`Field ${field} not found by name|text|CSS|XPath`);
  }
  let el = els[0];
  let tag = yield el.getTagName();
  let fieldVal = yield el.getAttribute('value');
  if (tag == 'select') {
    // locate option by values and check them
    let text = yield el.findElement(by.xpath(`./option[@value=${xpathLocator.literal(fieldVal)}]`)).getText();
    return equals('select option by ' + field)[assertType](value, text);
  }
  return stringIncludes('field by ' + field)[assertType](value, fieldVal);
}

function *proceedIsChecked(assertType, option) {
  return co(findCheckable(this.browser, option)).then((els) => {
    if (!els.length) {
      throw new Error(`Option ${option} not found by name|text|CSS|XPath`);
    }
    let elsSelected = [];
    els.forEach(function (el) {
      elsSelected.push(el.isSelected());
    });
    return Promise.all(elsSelected).then(function(values) {
      let selected = values.reduce((prev, cur) => prev || cur)
      return truth(`checkable ${option}`, 'to be checked')[assertType](selected);
    });
  });
}

function *findClickable(matcher, locator) {
  let l = guessLocator(locator);
  if (guessLocator(locator)) {
    return matcher.findElement(l);
  }

  let literal = xpathLocator.literal(locator);

  let narrowLocator = xpathLocator.combine([
    `.//a[normalize-space(.)=${literal}]`,
    `.//button[normalize-space(.)=${literal}]`,
    `.//a/img[normalize-space(@alt)=${literal}]/ancestor::a`,
    `.//input[./@type = 'submit' or ./@type = 'image' or ./@type = 'button'][normalize-space(@value)=${literal}]`
  ]);
  let els = yield matcher.findElements(by.xpath(narrowLocator));
  if (els.length) {
    return els[0];
  }

  let wideLocator = xpathLocator.combine([
    `.//a[./@href][((contains(normalize-space(string(.)), ${literal})) or .//img[contains(./@alt, ${literal})])]`,
    `.//input[./@type = 'submit' or ./@type = 'image' or ./@type = 'button'][contains(./@value, ${literal})]`,
    `.//input[./@type = 'image'][contains(./@alt, ${literal})]`,
    `.//button[contains(normalize-space(string(.)), ${literal})]`,
    `.//input[./@type = 'submit' or ./@type = 'image' or ./@type = 'button'][./@name = ${literal}]`,
    `.//button[./@name = ${literal}]`
  ]);

  els = yield matcher.findElements(by.xpath(wideLocator));
  if (els.length) {
    return els[0];
  }
  if (isXPath(locator)) {
    return matcher.findElement(by.xpath(locator));
  }
  return matcher.findElement(by.css(locator));
}

function guessLocator(locator) {
  if (!locator) {
    return;
  }
  if (typeof (locator) === 'object') {
    let key = Object.keys(locator)[0];
    let value = locator[key];
    locator.toString = () => `{${key}: '${value}'}`;
    return by[key](value);
  }
  if (isCSS(locator)) {
    return by.css(locator);
  }
  if (isXPath(locator)) {
    return by.xpath(locator);
  }
}

function isCSS(locator) {
  return locator[0] === '#' || locator[0] === '.';
}

function isXPath(locator) {
  return locator.substr(0, 2) === '//' || locator.substr(0, 3) === './/'
}