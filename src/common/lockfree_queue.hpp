#pragma once

#include <atomic>
#include <array>
#include <type_traits>

namespace nova {

// Lock-free single-producer single-consumer queue
// Provides interface compatible with boost::lockfree::spsc_queue
template <typename T, std::size_t Capacity>
class spsc_queue {
    static_assert(std::is_trivially_copyable_v<T>, "T must be trivially copyable");
    static_assert((Capacity & (Capacity - 1)) == 0, "Capacity must be a power of 2");

public:
    spsc_queue() : m_head(0), m_tail(0) {}

    // Try to push an element
    bool push(const T& value) {
        std::size_t next_tail = (m_tail.load(std::memory_order_relaxed) + 1) & (Capacity - 1);
        if (next_tail == m_head.load(std::memory_order_acquire)) {
            return false;  // Queue is full
        }
        m_buffer[m_tail.load(std::memory_order_relaxed)] = value;
        m_tail.store(next_tail, std::memory_order_release);
        return true;
    }

    // Try to pop an element
    bool pop(T& value) {
        std::size_t head = m_head.load(std::memory_order_acquire);
        if (head == m_tail.load(std::memory_order_relaxed)) {
            return false;  // Queue is empty
        }
        value = m_buffer[head];
        m_head.store((head + 1) & (Capacity - 1), std::memory_order_release);
        return true;
    }

    // Check if queue is empty
    bool empty() const {
        return m_head.load(std::memory_order_acquire) == m_tail.load(std::memory_order_acquire);
    }

    // Get approximate size (may be inaccurate in concurrent access)
    std::size_t size() const {
        std::size_t h = m_head.load(std::memory_order_acquire);
        std::size_t t = m_tail.load(std::memory_order_acquire);
        if (t >= h)
            return t - h;
        return Capacity - h + t;
    }

private:
    std::array<T, Capacity> m_buffer;
    std::atomic<std::size_t> m_head;
    std::atomic<std::size_t> m_tail;
};

// Lock-free multi-producer multi-consumer queue
// For SUPERNOVA builds - uses the same SPSC queue for simplicity
// Can be upgraded to moodycamel or another MPMC queue later
template <typename T, std::size_t Capacity>
class queue : public spsc_queue<T, Capacity> {
    // In SUPERNOVA with true MPMC needs, upgrade to moodycamel::ConcurrentQueue
    // For now, use SPSC as a conservative approach
};

}  // namespace nova
