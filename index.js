var //Requires
	osuapi = require('osu-api'),
	async = require('async');

module.exports = function (key) {
	var inst = {},
		osu = new osuapi.Api(key),
		watching = {},
		//Private Functions
		accuracy = function (score) {
			var hitscore = parseInt(score.count300, 10) * 300 + parseInt(score.count100, 10) * 100 + parseInt(score.count50, 10) * 50,
				hitcount = parseInt(score.count300, 10) + parseInt(score.count100, 10) + parseInt(score.count50, 10) + parseInt(score.countmiss, 10);
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
		decorateScore = function (current, score) {
			var scoreAccuracy = accuracy(current);
			if (score && scoresEqual(current, score)) {
				score.pp = parseInt(score.pp, 10);
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
			var relativePP = parseInt(user.pp_raw, 10) - userData.pp,
				relativeRank = parseInt(user.pp_rank, 10) - userData.rank;
			userData.pp = parseInt(user.pp_raw, 10);
			userData.rank = parseInt(user.pp_rank, 10);
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
				userData.cb(new Error('Stopped watching.'));
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
						userData.id = parseInt(result.user.user_id, 10);
						userData.pp = parseInt(result.user.pp_raw, 10);
						userData.rank = parseInt(result.user.pp_rank, 10);
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
						if (userData.recent && recentPlays[0] && !scoresEqual(userData.recent, recentPlays[0])) {
							var current = recentPlays[0];
							userData.recent = current;
							osu.setMode(userData.mode);
							async.parallel({
								score: getScore.bind(undefined, current.beatmap_id, userData.id, userData.mode),
								user: osu.getUser.bind(osu, userData.id)
							}, function (err, result) {
								if (err) {
									inst.unwatch(userData.user);
									userData.cb(err);
								} else {
									var score = decorateScore(current, result.score),
										user = decorateUser(userData, result.user);
									userData.cb(null, {
										score: score,
										user: user
									});
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
			user: osu.getUser.bind(osu, user)
		}, function (err, result) {
			if (err || !result.recent[0]) {
				cb(err);
			} else {
				getScore(result.recent[0].beatmap_id, result.user.user_id, mode, function (err, score) {
					if (err) {
						cb(err);
					} else {
						cb(null, decorateScore(result.recent[0], score));
					}
				});
			}
		});
	};
	return inst;
};