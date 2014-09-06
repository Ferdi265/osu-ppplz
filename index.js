var //Requires
	osuapi = require('osu-api'),
	async = require('async');

module.exports = function (key) {
	var inst = {},
		osu = new osuapi.Api(key),
		meta = {},
		//Private Functions
		accuracy = function (score) {
			var hitscore = parseFloat(score.count300, 10) * 300 + parseFloat(score.count100, 10) * 100 + parseFloat(score.count50, 10) * 50,
				hitcount = parseFloat(score.count300, 10) + parseFloat(score.count100, 10) + parseFloat(score.count50, 10) + parseFloat(score.countmiss, 10);
			return hitscore / (hitcount * 300) * 100;
		},
		scoresEqual = function (score1, score2) {
			return score1.score === score2.score &&
				score1.maxcombo === score2.maxcombo &&
				score1.count50 === score2.count50 &&
				score1.count100 === score2.count100 &&
				score1.count300 === score2.count300 &&
				score1.countkatu === score2.countkatu &&
				score1.countgeki === score2.countgeki &&
				score1.perfect === score2.perfect &&
				score1.enabled_mods === score2.enabled_mods;
		},
		indexInBest = function (score, best) {
			for (var i = 0, c = best.length; i < c; ++i) {
				if (scoresEqual(score, best[i])) {
					return i;
				}
			}
			return -1;
		},
		decorate = function (current, score, best, user, userData) {
			var decorated = {},
				scoreAccuracy = accuracy(current),
				relativePP,
				relativeRank,
				index;
			if (userData.pp && userData.rank) {
				relativePP = parseFloat(user.pp_raw, 10) - userData.pp;
				relativeRank = parseInt(user.pp_rank, 10) - userData.rank;
				user.relative_pp = relativePP;
				user.relative_rank = relativeRank;
				user.relative = true;
			} else {
				user.relative = false;
			}
			userData.pp = parseFloat(user.pp_raw, 10);
			userData.rank = parseInt(user.pp_rank, 10);
			user.pp = parseFloat(user.pp_raw, 10);
			user.rank = parseInt(user.pp_rank, 10);
			decorated.user = user;
			if (score && scoresEqual(current, score)) {
				index = indexInBest(score, best);
				score.pp_raw = parseFloat(score.pp, 10);
				score.accuracy = scoreAccuracy;
				score.beatmap_id = current.beatmap_id;
				score.pb = true;
				if (index !== -1) {
					score.pp_weighted = score.pp_raw * Math.pow(0.95, index);
				}
				decorated.score = score;
			} else {
				current.accuracy = scoreAccuracy;
				current.pb = false;
				decorated.score = current;
			}
			return decorated;
		},
		timeout = null,
		buffer = [],
		process = function () {
			var fn = buffer.splice(0, 1)[0];
			if (fn) {
				fn();
				timeout = setTimeout(process, 1000);
			} else {
				timeout = null;
			}
		},
		throttle = function (fn) {
			buffer.push(fn);
			if (timeout === null) {
				timeout = setTimeout(process, 0);
			}
		},
		watch = function (userData) {
			if (userData.watching.stop) {
				userData.watching.cb('Stopped watching.');
				delete userData.watching;
			} else if (!userData.watching.start) {
				osu.setMode(userData.watching.mode);
				async.parallel({
					recentPlays: osu.getUserRecent.bind(osu, userData.user),
					user: osu.getUser.bind(osu, userData.user)
				}, function (err, result) {
					if (err) {
						inst.unwatch(userData.user);
						userData.watching.cb(err);
						throttle(watch.bind(undefined, userData));
					} else {
						userData.id = parseInt(result.user.user_id, 10);
						userData.pp = parseFloat(result.user.pp_raw, 10);
						userData.rank = parseInt(result.user.pp_rank, 10);
						userData.watching.recent = result.recentPlays[0];
						userData.watching.start = true;
						throttle(watch.bind(undefined, userData));
					}
				});
			} else {
				osu.setMode(userData.watching.mode);
				osu.getUserRecent(userData.id, function (err, recentPlays) {
					if (err) {
						inst.unwatch(userData.user);
						userData.watching.cb(err);
						throttle(watch.bind(undefined, userData));
					} else {
						if ((!userData.watching.recent && recentPlays[0]) ||  (userData.watching.recent && recentPlays[0] && !scoresEqual(userData.watching.recent, recentPlays[0]))) {
							var current = recentPlays[0];
							userData.watching.recent = current;
							userData.lastAction = Date.now();
							osu.setMode(userData.watching.mode);
							async.parallel({
								score: getScore.bind(undefined, current.beatmap_id, userData.id, userData.watching.mode),
								user: osu.getUser.bind(osu, userData.id),
								best: osu.getUserBestRaw.bind(osu, {
									m: userData.watching.mode,
									u: userData.id,
									type: 'id',
									limit: 50
								})
							}, function (err, result) {
								if (err) {
									inst.unwatch(userData.user);
									userData.watching.cb(err);
									throttle(watch.bind(undefined, userData));
								} else {
									userData.watching.cb(null, decorate(current, result.score, result.best, result.user, userData));
									throttle(watch.bind(undefined, userData));
								}
							});
						} else {
							if (Date.now() - userData.lastAction > 1000 * 60 * 15) {
								inst.unwatch(userData.user);
								throttle(watch.bind(undefined, userData));
							} else {
								throttle(watch.bind(undefined, userData));
							}
						}
					}
				});
			}
		},
		getScore = function (beatmapId, userId, mode, cb) {
			if (!cb) {
				cb = mode;
				mode = osuapi.Modes.osu;
			}
			osu.setMode(mode);
			osu.getUserScore(beatmapId, userId, function (err, score) {
				if (err) {
					cb(err);
				} else {
					if (!score || score.pp !== null) {
						cb(null, score);
					} else {
						setTimeout(getScore.bind(undefined, beatmapId, userId, cb), 2000);
					}
				}
			});
		};
	inst.osu = osu;
	inst.Modes = osuapi.Modes;
	inst.Mods = {
		Hidden: 8,
		HardRock: 16,
		SuddenDeath: 32,
		Perfect: 16384,
		DoubleTime: 64,
		NightCore: 512,
		FlashLight: 1024,
		FadeIn: 1048576,
		Easy: 2,
		NoFail: 1,
		HalfTime: 256,
		SpunOut: 4096,
		Key4: 32768,
		Key5: 65536,
		Key6: 131072,
		Key7: 262144,
		Key8: 524288,
	};
	inst.watch = function (user, mode, cb) {
		if (!meta[user]) {
			meta[user] = {
				user: user
			};
		}
		meta[user].lastAction = Date.now();
		if (!meta[user].watching) {
			if (!cb) {
				cb = mode;
				mode = osuapi.Modes.osu;
			}
			meta[user].watching = {
				cb: cb,
				mode: mode
			};
			throttle(watch.bind(undefined, meta[user]));
		}
	};
	inst.watching = function (user) {
		if (user) {
			return Boolean(meta[user] ? meta[user].watching : false);
		} else {
			return Object.keys(meta).filter(function (userName) {
				return Boolean(meta[userName].watching);
			});
		}
	};
	inst.unwatch = function (user) {
		if (user) {
			if (meta[user] && meta[user].watching) {
				meta[user].watching.stop = true;
			}
		} else {
			Object.keys(meta).forEach(function (userName) {
				if (meta[userName] && meta[userName].watching) {
					meta[userName].watching.stop = true;
				}
			});
		}
	};
	inst.lastScore = function (user, mode, cb) {
		var userData;
		if (!meta[user]) {
			meta[user] = {
				user: user
			};
		}
		userData = meta[user];
		userData.lastAction = Date.now();
		if (!cb) {
			cb = mode;
			mode = osuapi.Modes.osu;
		}
		osu.setMode(mode);
		async.parallel({
			recent: osu.getUserRecent.bind(osu, user),
			user: osu.getUser.bind(osu, user),
		}, function (err, result) {
			if (err || !result.recent[0]) {
				cb(err);
			} else {
				var current = result.recent[0],
					user = result.user;
				userData.id = parseInt(user.user_id, 10);
				async.parallel({
					score: getScore.bind(undefined, current.beatmap_id, userData.id, mode),
					best: osu.getUserBestRaw.bind(osu, {
						m: mode,
						u: user.id,
						type: 'id',
						limit: 50
					})
				}, function (err, result) {
					if (err) {
						cb(err);
					} else {
						cb(null, decorate(current, result.score, result.best, user, userData));
					}
				});
			}
		});
	};
	return inst;
};