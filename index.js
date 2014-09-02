var //Requires
	osuapi = require('osu-api'),
	async = require('async');

module.exports = function (key) {
	var inst = {},
		osu = new osuapi.Api(key),
		watching = {},
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
			if (userData) {
				relativePP = parseFloat(user.pp_raw, 10) - userData.pp;
				relativeRank = parseFloat(user.pp_rank, 10) - userData.rank;
				userData.pp = parseFloat(user.pp_raw, 10);
				userData.rank = parseFloat(user.pp_rank, 10);
				user.relative_pp = relativePP;
				user.relative_rank = relativeRank;
				user.relative = true;
			} else {
				user.relative = false;
			}
			user.pp = parseFloat(user.pp_raw, 10);
			user.rank = parseFloat(user.pp_rank, 10);
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
		decorateScore = function (current, score) {
			var scoreAccuracy = accuracy(current);
			if (score && scoresEqual(current, score)) {
				score.pp = parseFloat(score.pp, 10);
				score.accuracy = scoreAccuracy;
				score.beatmap_id = current.beatmap_id;
				score.pb = true;
				return score;
			} else {
				current.accuracy = scoreAccuracy;
				current.pb = false;
				return current;
			}
		},
		decorateUser = function (userData, user) {
			var relativePP = parseFloat(user.pp_raw, 10) - userData.pp,
				relativeRank = parseFloat(user.pp_rank, 10) - userData.rank;
			userData.pp = parseFloat(user.pp_raw, 10);
			userData.rank = parseFloat(user.pp_rank, 10);
			user.pp = userData.pp;
			user.rank = userData.rank;
			user.relative_pp = relativePP;
			user.relative_rank = relativeRank;
			return user;
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
			if (userData.stop) {
				userData.cb('Stopped watching.');
			} else if (!userData.id) {
				osu.setMode(userData.mode);
				async.parallel({
					recentPlays: osu.getUserRecent.bind(osu, userData.user),
					user: osu.getUser.bind(osu, userData.user)
				}, function (err, result) {
					if (err) {
						inst.unwatch(userData.user);
						userData.cb(err);
					} else {
						userData.id = parseFloat(result.user.user_id, 10);
						userData.pp = parseFloat(result.user.pp_raw, 10);
						userData.rank = parseFloat(result.user.pp_rank, 10);
						userData.recent = result.recentPlays[0];
						throttle(watch.bind(undefined, userData));
					}
				});
			} else {
				osu.setMode(userData.mode);
				osu.getUserRecent(userData.id, function (err, recentPlays) {
					if (err) {
						inst.unwatch(userData.user);
						userData.cb(err);
					} else {
						if ((!userData.recent && recentPlays[0]) ||  (userData.recent && recentPlays[0] && !scoresEqual(userData.recent, recentPlays[0]))) {
							var current = recentPlays[0];
							userData.recent = current;
							osu.setMode(userData.mode);
							async.parallel({
								score: getScore.bind(undefined, current.beatmap_id, userData.id, userData.mode),
								user: osu.getUser.bind(osu, userData.id),
								best: osu.getUserBestRaw.bind(osu, {
									m: userData.mode,
									u: userData.id,
									type: 'id',
									limit: 50
								})
							}, function (err, result) {
								if (err) {
									inst.unwatch(userData.user);
									userData.cb(err);
								} else {
									userData.cb(null, decorate(current, result.score, result.best, result.user, userData));
									throttle(watch.bind(undefined, userData));
								}
							});
						} else {
							throttle(watch.bind(undefined, userData));
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
	inst.watch = function (user, mode, cb) {
		if (!watching[user]) {
			if (!cb) {
				cb = mode;
				mode = osuapi.Modes.osu;
			}
			watching[user] = {
				cb: cb,
				user: user,
				mode: mode
			};
			throttle(watch.bind(undefined, watching[user]));
		}
	};
	inst.watching = function (user) {
		return Boolean(watching[user]);
	};
	inst.unwatch = function (user) {
		if (watching[user]) {
			watching[user].stop = true;
			delete watching[user];
		}
	};
	inst.lastScore = function (user, mode, cb) {
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
				async.parallel({
					score: getScore.bind(undefined, current.beatmap_id, user.user_id, mode),
					best: osu.getUserBestRaw.bind(osu, {
						m: mode,
						u: user.user_id,
						type: 'id',
						limit: 50
					})
				}, function (err, result) {
					if (err) {
						cb(err);
					} else {
						cb(null, decorate(current, result.score, result.best, user));
					}
				});
			}
		});
	};
	return inst;
};