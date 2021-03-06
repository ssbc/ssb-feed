'use strict'
var ssbKeys = require('ssb-keys')
var timestamp = require('monotonic-timestamp')
var isRef = require('ssb-ref')
var isHash = isRef.isHash
var isFeedId = isRef.isFeedId

var encode = exports.encode = function (obj) {
  return JSON.stringify(obj, null, 2)
}

function isString (s) {
  return 'string' === typeof s
}

function isInteger (n) {
  return ~~n === n
}

function isObject (o) {
  return o && 'object' === typeof o
}

function clone (obj) {
  var o = {}
  for(var k in obj) o[k] = obj[k];
  return o
}

function isEncrypted (str) {
  return isString(str) && /^[0-9A-Za-z\/+]+={0,2}\.box/.test(str)
}

exports.toBuffer = function (b) {
  if('string' == typeof b) return new Buffer(b, 'base64')
  return b
}


exports.BatchQueue = function BatchQueue (db) {

  var batch = [], writing = false

  function drain () {
    writing = true
    var _batch = batch
    batch = []

    db.batch(_batch, function () {
      writing = false
      write.size = batch.length
      if(batch.length) drain()
      _batch.forEach(function (op) {
        op.cb(null, {key:op.key, value: op.value})
      })
    })
  }

  function write (op) {
    batch.push(op)
    write.size = batch.length
    if(!writing) drain()
  }

  write.size = 0

  return write
}

exports.create = function (keys, type, content, prev, prev_key, sign_cap) {

  //this noise is to handle things calling this with legacy api.
  if(isString(type) && (Buffer.isBuffer(content) || isString(content)))
    content = {type: type, value: content}
  if(isObject(content))
    content.type = content.type || type
  //noise end

  prev_key = !prev_key && prev ? ('%'+ssbKeys.hash(encode(prev))) : prev_key || null
  
  return ssbKeys.signObj(keys, sign_cap, {
    previous: prev_key,
    author: keys.id,
    sequence: prev ? prev.sequence + 1 : 1,
    timestamp: timestamp(),
    hash: 'sha256',
    content: content,
  })
}

var isInvalidContent = exports.isInvalidContent = function (content) {
  if(!isEncrypted(content)) {

    var type = content.type

    if (!(isString(type) && type.length <= 52 && type.length >= 3)) {
      return new Error('type must be a string' +
        '3 <= type.length < 52, was:' + type
      )
    }
  }
  return false
}

exports.isInvalidShape = function (msg) {
  if(
    !isObject(msg) ||
    !isInteger(msg.sequence) ||
    !isFeedId(msg.author) ||
    !(isObject(msg.content) || isEncrypted(msg.content))
  )
    return new Error('message has invalid properties')

  //allow encrypted messages, where content is a base64 string.

  var asJson = encode(msg)
  if (asJson.length > 8192) // 8kb
    return new Error( 'encoded message must not be larger than 8192 bytes')

  return isInvalidContent(msg.content)
}

exports.isInvalid = function (pub, msg, previous, sign_cap) {
  // :TODO: is there a faster way to measure the size of this message?

  var key = previous.key
  var prev = previous.value

  if(prev) {
    if(msg.previous !== key) {
      return new Error(
          'expected previous: '
        + key
        + ' but found:' + msg.previous
      )
    }

    if(msg.sequence !== prev.sequence + 1
     || msg.timestamp <= prev.timestamp)
        return new Error('out of order')
  }
  else {
    if(!(msg.previous == null
      && msg.sequence === 1 && msg.timestamp > 0))
        return new Error('expected initial message')
  }

  if(msg.author !== pub) {

    return new Error(
        'expected different author:'
      + hash(pub.public || pub).toString('base64')
      + 'but found:' + msg.author.toString('base64')
    )
  }

  if(!ssbKeys.verifyObj(pub, sign_cap, msg))
    return new Error('signature was invalid')

  return false
}



