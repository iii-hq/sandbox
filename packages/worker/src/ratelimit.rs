use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct RateLimitConfig {
    pub enabled: bool,
    pub token_requests_per_minute: u32,
    pub token_burst: u32,
    pub sandbox_exec_per_minute: u32,
    pub sandbox_fs_ops_per_minute: u32,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            token_requests_per_minute: 600,
            token_burst: 100,
            sandbox_exec_per_minute: 120,
            sandbox_fs_ops_per_minute: 300,
        }
    }
}

struct TokenBucket {
    capacity: f64,
    tokens: f64,
    last_refill: Instant,
    rate_per_second: f64,
}

impl TokenBucket {
    fn new(capacity: u32, rate_per_minute: u32) -> Self {
        Self {
            capacity: capacity as f64,
            tokens: capacity as f64,
            last_refill: Instant::now(),
            rate_per_second: rate_per_minute as f64 / 60.0,
        }
    }

    fn try_consume(&mut self) -> bool {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.rate_per_second).min(self.capacity);
        self.last_refill = now;

        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

#[derive(Clone)]
pub struct RateLimiter {
    inner: Arc<Mutex<HashMap<String, TokenBucket>>>,
    config: RateLimitConfig,
}

#[allow(dead_code)]
impl RateLimiter {
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            config,
        }
    }

    pub fn check_token(&self, token: &str) -> bool {
        if !self.config.enabled {
            return true;
        }
        let mut buckets = self.inner.lock().unwrap();
        let bucket = buckets
            .entry(format!("token:{token}"))
            .or_insert_with(|| {
                TokenBucket::new(self.config.token_burst, self.config.token_requests_per_minute)
            });
        bucket.try_consume()
    }

    pub fn check_sandbox_exec(&self, sandbox_id: &str) -> bool {
        if !self.config.enabled {
            return true;
        }
        let mut buckets = self.inner.lock().unwrap();
        let bucket = buckets
            .entry(format!("sbx-exec:{sandbox_id}"))
            .or_insert_with(|| {
                TokenBucket::new(
                    self.config.sandbox_exec_per_minute,
                    self.config.sandbox_exec_per_minute,
                )
            });
        bucket.try_consume()
    }

    pub fn check_sandbox_fs(&self, sandbox_id: &str) -> bool {
        if !self.config.enabled {
            return true;
        }
        let mut buckets = self.inner.lock().unwrap();
        let bucket = buckets
            .entry(format!("sbx-fs:{sandbox_id}"))
            .or_insert_with(|| {
                TokenBucket::new(
                    self.config.sandbox_fs_ops_per_minute,
                    self.config.sandbox_fs_ops_per_minute,
                )
            });
        bucket.try_consume()
    }

    pub fn cleanup_stale(&self) {
        let mut buckets = self.inner.lock().unwrap();
        let now = Instant::now();
        buckets.retain(|_, bucket| {
            now.duration_since(bucket.last_refill).as_secs() < 300
        });
    }

    pub fn bucket_count(&self) -> usize {
        self.inner.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled_config() -> RateLimitConfig {
        RateLimitConfig {
            enabled: true,
            token_requests_per_minute: 60,
            token_burst: 10,
            sandbox_exec_per_minute: 12,
            sandbox_fs_ops_per_minute: 30,
        }
    }

    #[test]
    fn disabled_always_allows() {
        let limiter = RateLimiter::new(RateLimitConfig::default());
        for _ in 0..1000 {
            assert!(limiter.check_token("any-token"));
        }
    }

    #[test]
    fn token_burst_then_reject() {
        let limiter = RateLimiter::new(enabled_config());
        for _ in 0..10 {
            assert!(limiter.check_token("t1"));
        }
        assert!(!limiter.check_token("t1"));
    }

    #[test]
    fn different_tokens_independent() {
        let limiter = RateLimiter::new(enabled_config());
        for _ in 0..10 {
            assert!(limiter.check_token("a"));
        }
        assert!(!limiter.check_token("a"));
        assert!(limiter.check_token("b"));
    }

    #[test]
    fn sandbox_exec_limit() {
        let limiter = RateLimiter::new(enabled_config());
        for _ in 0..12 {
            assert!(limiter.check_sandbox_exec("sbx1"));
        }
        assert!(!limiter.check_sandbox_exec("sbx1"));
    }

    #[test]
    fn sandbox_fs_limit() {
        let limiter = RateLimiter::new(enabled_config());
        for _ in 0..30 {
            assert!(limiter.check_sandbox_fs("sbx1"));
        }
        assert!(!limiter.check_sandbox_fs("sbx1"));
    }

    #[test]
    fn exec_and_fs_independent() {
        let limiter = RateLimiter::new(enabled_config());
        for _ in 0..12 {
            limiter.check_sandbox_exec("sbx1");
        }
        assert!(limiter.check_sandbox_fs("sbx1"));
    }

    #[test]
    fn cleanup_removes_stale() {
        let limiter = RateLimiter::new(enabled_config());
        limiter.check_token("t1");
        assert_eq!(limiter.bucket_count(), 1);
        limiter.cleanup_stale();
        assert_eq!(limiter.bucket_count(), 1);
    }

    #[test]
    fn bucket_count_tracks_unique_keys() {
        let limiter = RateLimiter::new(enabled_config());
        limiter.check_token("a");
        limiter.check_token("b");
        limiter.check_sandbox_exec("sbx1");
        assert_eq!(limiter.bucket_count(), 3);
    }

    #[test]
    fn default_config_disabled() {
        let cfg = RateLimitConfig::default();
        assert!(!cfg.enabled);
        assert_eq!(cfg.token_requests_per_minute, 600);
        assert_eq!(cfg.token_burst, 100);
        assert_eq!(cfg.sandbox_exec_per_minute, 120);
        assert_eq!(cfg.sandbox_fs_ops_per_minute, 300);
    }
}
